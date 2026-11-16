using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace QrPrinter.Agent.Config;

/// <summary>
/// The device token minted once from a pairing code. It is the agent's identity,
/// so losing it means the shop has to be re-paired from the dashboard.
/// </summary>
public sealed record DeviceIdentity(
    string DeviceId,
    string Token,
    string MachineKey,
    DateTimeOffset PairedAtUtc)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// Non-secret per-machine hint so the dashboard can say "this looks like the
    /// PC you paired before". Built from machine guidance values only, never from
    /// document content, and it is a hint: the server never trusts it alone.
    ///
    /// It changes if the shop moves the agent to a different Windows account,
    /// which is why pairing still needs the code.
    /// </summary>
    public static string ComputeMachineKey()
    {
        var components = new[]
        {
            Environment.MachineName,
            Environment.UserDomainName,
            RuntimeInformation.OSDescription,
        };
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('|', components)));
        return Convert.ToHexStringLower(bytes[..16]);
    }

    public static DeviceIdentity? Load()
    {
        if (!File.Exists(AgentPaths.IdentityFile))
            return null;

        return JsonSerializer.Deserialize<DeviceIdentity>(File.ReadAllText(AgentPaths.IdentityFile), Json);
    }

    public void Save()
    {
        AgentPaths.EnsureDirectories();
        File.WriteAllText(AgentPaths.IdentityFile, JsonSerializer.Serialize(this, Json));
        TryRestrictToCurrentUser();
    }

    /// <summary>
    /// The token grants printing on the shop's printers, so narrow the ACL to
    /// the account that paired, plus read access for the agent service.
    /// Best effort only: under a service the file may already be owned by an
    /// admin.
    /// </summary>
    private static void TryRestrictToCurrentUser()
    {
        try
        {
            if (!OperatingSystem.IsWindows())
                return;

            // The SID, not the name: `HP` alone is ambiguous on a machine that
            // also has a local and a Microsoft account of that name, and a name
            // with a space or a backslash has to survive shell quoting.
            var sid = System.Security.Principal.WindowsIdentity.GetCurrent().User?.Value;
            if (string.IsNullOrEmpty(sid))
                return;

            // icacls spells quiet `/Q` — `/quiet` is rejected outright.
            RunIcacls("/inheritance:r", "/grant:r", $"*{sid}:(R,W)", "/Q");

            // A separate call: icacls rejects the service SID until the service
            // exists, and that must never undo the narrowing above. When the
            // service is installed later, `service install` grants it instead.
            RunIcacls("/grant", $"*{Service.ServiceHost.Sid}:(R)", "/Q");
        }
        catch
        {
            // Never fail a pairing because an ACL tweak was refused.
        }
    }

    private static void RunIcacls(params string[] arguments)
    {
        // System32 by full path, so an icacls.exe in the current folder is never the one run.
        var psi = new System.Diagnostics.ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "icacls.exe"))
        {
            UseShellExecute = false,
            // Redirected rather than discarded: icacls writes one short line,
            // and none of it belongs on a counter terminal.
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        // ArgumentList, not one string: the identity path comes from the
        // machine and must never become extra switches.
        psi.ArgumentList.Add(AgentPaths.IdentityFile);
        foreach (var argument in arguments)
            psi.ArgumentList.Add(argument);

        using var process = System.Diagnostics.Process.Start(psi);
        process?.WaitForExit(3000);
    }
}
