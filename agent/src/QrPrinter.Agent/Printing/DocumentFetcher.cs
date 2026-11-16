using System.Security.Cryptography;

namespace QrPrinter.Agent.Printing;

/// <summary>
/// A document that has been pulled down to this machine and is ready to print.
/// </summary>
/// <remarks><see cref="Path"/> is deliberately not logged anywhere.</remarks>
public sealed record DownloadedDocument(string Path, long Bytes, string Sha256);

/// <summary>
/// Streams a job document into the agent's spool folder.
///
/// Three things this guards against, in order of how much they would hurt:
///   * an unbounded download filling the shop PC, checked while streaming;
///   * a payload pointing at a host nobody agreed to talk to, checked against
///     the origin in config.json;
///   * a half-written file printing as a truncated document, handled by
///     writing to .part and moving once the bytes are all there.
/// </summary>
public static class DocumentFetcher
{
    public static async Task<DownloadedDocument> FetchAsync(
        Uri source,
        string jobId,
        Config.AgentConfig config,
        CancellationToken cancel)
    {
        if (!PrintSettings.IsSafeJobId(jobId))
            throw new ArgumentException($"job id {jobId} cannot be used as a file name");

        // Same rule as the config check, so a bench server on http://localhost
        // works here too and a remote one cannot. Anything else is clear text.
        if (!Config.AgentConfig.IsAllowedUnencrypted(source))
            throw new InvalidOperationException("a document must come over https (or http from localhost only)");

        var allowed = new Uri(config.ApiBaseUrl);
        if (!string.Equals(source.Host, allowed.Host, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"refusing to fetch from {source.Host}: documents must come from {allowed.Host}");

        Directory.CreateDirectory(Config.AgentPaths.SpoolDir);
        var finalPath = Path.Combine(Config.AgentPaths.SpoolDir, PrintSettings.SpoolFileName(jobId));
        var partPath = finalPath + ".part";

        using var client = new HttpClient(new HttpClientHandler
        {
            AllowAutoRedirect = false,
        })
        {
            Timeout = TimeSpan.FromSeconds(Math.Max(30, config.PrintTimeoutSeconds)),
        };

        long total = 0;
        string sha256;

        using (var response = await client
                   .GetAsync(source, HttpCompletionOption.ResponseHeadersRead, cancel)
                   .ConfigureAwait(false))
        {
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"the server answered {(int)response.StatusCode} for this document");

            var declared = response.Content.Headers.ContentLength ?? -1;
            if (declared > config.MaxDocumentBytes)
                throw new InvalidOperationException(
                    $"this document is {declared} bytes and the limit is {config.MaxDocumentBytes}");

            await using var remote = await response.Content
                .ReadAsStreamAsync(cancel).ConfigureAwait(false);
            await using var local = new FileStream(
                partPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, FileOptions.WriteThrough);

            using var hasher = SHA256.Create();
            var buffer = new byte[81920];
            int read;
            while ((read = await remote.ReadAsync(buffer, cancel).ConfigureAwait(false)) > 0)
            {
                total += read;
                if (total > config.MaxDocumentBytes)
                {
                    TryDelete(partPath);
                    throw new InvalidOperationException(
                        $"the document passed the {config.MaxDocumentBytes} byte limit and was discarded");
                }

                hasher.TransformBlock(buffer, 0, read, null, 0);
                await local.WriteAsync(buffer.AsMemory(0, read), cancel).ConfigureAwait(false);
            }

            await local.FlushAsync(cancel).ConfigureAwait(false);
            hasher.TransformFinalBlock([], 0, 0);
            sha256 = Convert.ToHexStringLower(hasher.Hash!);
        }

        if (total == 0)
        {
            TryDelete(partPath);
            throw new InvalidOperationException("the server sent an empty document");
        }

        File.Move(partPath, finalPath, overwrite: true);
        return new DownloadedDocument(finalPath, total, sha256);
    }

    /// <summary>
    /// Remove the document once the job is finished, whether it printed or not.
    /// Customer pages do not linger on a shop PC.
    /// </summary>
    /// <remarks>
    /// This is an unlink, not a secure erase — a forensically interested party
    /// with the disk in a reader could still recover blocks. Say so rather than
    /// implying more than the code does.
    /// </remarks>
    public static void Discard(DownloadedDocument? document)
    {
        if (document == null)
            return;

        TryDelete(document.Path);
        TryDelete(document.Path + ".part");
    }

    /// <summary>Delete anything older than the configured age in the spool folder.</summary>
    public static int SweepStale(int keepHours)
    {
        try
        {
            var cutoff = DateTime.UtcNow - TimeSpan.FromHours(Math.Max(1, keepHours));
            var removed = 0;
            foreach (var path in Directory.EnumerateFiles(Config.AgentPaths.SpoolDir, "QP-*"))
            {
                if (new FileInfo(path).LastWriteTimeUtc >= cutoff)
                    continue;
                if (TryDelete(path))
                    removed++;
            }

            return removed;
        }
        catch (IOException)
        {
            return 0;
        }
    }

    private static bool TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.SetAttributes(path, FileAttributes.Normal);
                File.Delete(path);
                return true;
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }

        return false;
    }
}
