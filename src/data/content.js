/**
 * Every word on the landing page lives here.
 *
 * Rules this file follows, and that any edit should keep following:
 *  - No invented customer counts, testimonials, certifications or partnerships.
 *  - No claims about behaviour that has not been built. Where a detail is not
 *    final, the copy says so and points at the help centre or support email.
 *  - Plain English: the reader runs a shop, they do not read engineering docs.
 *
 * `icon` values must exist in src/components/ui/Icon.jsx.
 */

export const hero = {
  eyebrow: 'For cyber cafes, photocopy shops and document centres',
  title: 'Complete Printing & Scanning Management for Cyber Cafes.',
  description:
    'Manage document scanning, printing, multiple printers, and print jobs from one simple platform. Save time, reduce manual work, and serve your customers faster.',
  primaryCta: { label: 'Get Started', kind: 'signup' },
  secondaryCta: { label: 'Explore Features', href: '#features' },
  highlights: [
    { icon: 'printer', label: 'Multi-Printer Support' },
    { icon: 'list-checks', label: 'Smart Print Management' },
    { icon: 'plug', label: 'Easy Device Integration' },
  ],
  trustNote:
    'One account per shop. Your printers and scanners stay on your own computer.',
  /** The glass chip that overlaps the hero preview. */
  floatCard: {
    icon: 'printer',
    title: 'Uses the printers you already own',
    text: 'USB or network, through one small agent',
  },
}

export const benefits = {
  eyebrow: 'Why shop owners switch',
  title: 'Less running between the counter and the computer',
  description:
    'Most of the day in a cyber cafe is small, repeated tasks. This platform moves them into one screen so your staff can finish faster and make fewer mistakes.',
  items: [
    {
      icon: 'workflow',
      title: 'Simplify daily printing operations',
      text: 'Accept a job, check the page count and send it to a printer without leaving one screen.',
    },
    {
      icon: 'printer',
      title: 'Manage multiple printers',
      text: 'Keep every printer in the shop in one list and choose which one takes each job.',
    },
    {
      icon: 'repeat',
      title: 'Reduce repetitive manual work',
      text: 'Stop re-typing the same customer, file and page details for every single print.',
    },
    {
      icon: 'list-checks',
      title: 'Track print jobs',
      text: 'See whether a job is waiting, printing, finished or failed before a customer asks.',
    },
    {
      icon: 'scan',
      title: 'Simplify document scanning',
      text: 'Scan documents with a supported scanner connected to your shop computer.',
    },
    {
      icon: 'zap',
      title: 'Improve customer service speed',
      text: 'Shorter queues at the counter when printing and scanning take fewer steps.',
    },
  ],
}

export const features = {
  eyebrow: 'Features',
  title: 'Everything the counter needs, in one place',
  description:
    'Start with the printers and scanners you already own. Turn on more of this list as your shop grows.',
  /**
   * `status` keeps the page honest:
   *  'live'    — built and working today, safe to advertise
   *  'planned' — renders a visible "Coming soon" tag instead of a promise
   * Set each one to match your actual release before you publish.
   */
  items: [
    {
      icon: 'printer',
      title: 'Multi-Printer Management',
      text: 'Add every connected printer to one dashboard and send each job to the right machine.',
      status: 'live',
    },
    {
      icon: 'scan',
      title: 'Document Scanning',
      text: 'Scan documents through supported scanners connected to your shop computer.',
      status: 'live',
    },
    {
      icon: 'file-text',
      title: 'Print Job Management',
      text: 'Submit jobs, watch them move through the system and manage them until they are done.',
      status: 'live',
    },
    {
      icon: 'list-ordered',
      title: 'Print Queue',
      text: 'See pending, processing, completed and failed jobs in one clear queue view.',
      status: 'live',
    },
    {
      icon: 'activity',
      title: 'Printer Status',
      text: 'Check which printers are reachable and which are free, busy or disconnected.',
      status: 'live',
    },
    {
      icon: 'plug',
      title: 'Local Agent Integration',
      text: 'A small program on your computer links the web platform to your printers and scanners.',
      status: 'live',
    },
    {
      icon: 'history',
      title: 'Job History',
      text: 'Look back at previous printing and scanning activity when a customer asks about a job.',
      status: 'live',
    },
    {
      icon: 'users',
      title: 'User Management',
      text: 'Give your staff their own sign-in and control what each of them is allowed to do.',
      status: 'live',
    },
  ],
}

export const steps = {
  eyebrow: 'How it works',
  title: 'Four steps from signup to your first job',
  description:
    'You do not need to be technical. Each step takes a few minutes, and the local agent is a normal program you install once.',
  items: [
    {
      icon: 'user-plus',
      title: 'Create Your Account',
      text: 'Register your cyber cafe with your shop name, address and contact details.',
    },
    {
      icon: 'download',
      title: 'Install the Local Agent',
      text: 'Install the desktop agent on the computer that your printers and scanners are connected to.',
    },
    {
      icon: 'plug',
      title: 'Connect Your Devices',
      text: 'Let the agent detect your supported printers and scanners, then confirm the ones you use.',
    },
    {
      icon: 'play',
      title: 'Start Managing Jobs',
      text: 'Use the web dashboard to run your supported scanning and printing work.',
    },
  ],
}

export const compatibility = {
  eyebrow: 'Compatibility',
  title: 'Works with the equipment you already have',
  description:
    'The local agent runs on your shop computer and talks to the devices plugged into it. Other computers in the shop can then use the platform from a browser.',
  items: [
    {
      icon: 'monitor',
      title: 'Windows desktop integration',
      text: 'The agent installs on the Windows computer your printers and scanners are attached to.',
    },
    {
      icon: 'usb',
      title: 'USB-connected printers',
      text: 'Printers cabled directly to that computer are the simplest setup to start with.',
    },
    {
      icon: 'network',
      title: 'Network-connected printers',
      text: 'Printers reachable over your shop network can also be added to the dashboard.',
    },
    {
      icon: 'scan',
      title: 'Supported scanners',
      text: 'Scanners recognised by Windows on that computer can be used for document scanning.',
    },
    {
      icon: 'layers',
      title: 'Multiple device management',
      text: 'Run several printers and scanners from one shop account as your setup grows.',
    },
  ],
  /**
   * Deliberately unproven claims stay off the page. Keep this list honest and
   * link the detailed matrix from the help centre instead of asserting it here.
   */
  disclosure:
    'Device support depends on your printer model, scanner model and the drivers installed on your computer. Check your exact model with our support team before you commit to a plan.',
}

export const dashboard = {
  eyebrow: 'The dashboard',
  title: 'What your day looks like on one screen',
  description:
    'Counts at the top, printers in the middle, and a running list of jobs below. This is a preview built with sample data — your own jobs and devices appear here once you are set up.',
  caption:
    'Sample data. Your own printers, job counts and scan history appear in this layout once the agent is installed.',
  stats: [
    { label: 'Total print jobs', value: '128', meta: 'Today', tone: 'neutral' },
    { label: 'Completed', value: '104', meta: '81% of today', tone: 'success' },
    { label: 'Pending', value: '17', meta: 'Waiting in queue', tone: 'warn' },
    { label: 'Connected printers', value: '4 of 5', meta: '1 offline', tone: 'neutral' },
  ],
  printers: [
    { name: 'Counter LaserJet', kind: 'USB', status: 'online', queue: 2 },
    { name: 'Colour Duplexer', kind: 'Network', status: 'busy', queue: 1 },
    { name: 'Bill Print', kind: 'USB', status: 'online', queue: 0 },
    { name: 'A3 Plotter', kind: 'Network', status: 'offline', queue: 0 },
  ],
  jobs: [
    { id: 'J-1042', file: 'aadhaar-scan-01.pdf', pages: 2, copies: 3, printer: 'Counter LaserJet', state: 'completed', time: '11:42' },
    { id: 'J-1043', file: 'resume-rakesh.pdf', pages: 1, copies: 4, printer: 'Colour Duplexer', state: 'processing', time: '11:47' },
    { id: 'J-1044', file: 'form-16-sup.pdf', pages: 8, copies: 1, printer: 'Counter LaserJet', state: 'pending', time: '11:51' },
    { id: 'J-1045', file: 'shop-photo-bill.pdf', pages: 1, copies: 2, printer: 'Bill Print', state: 'failed', time: '11:55' },
    { id: 'J-1046', file: 'land-record-03.pdf', pages: 14, copies: 1, printer: 'Colour Duplexer', state: 'pending', time: '11:58' },
  ],
  scans: [
    { file: 'pan-card-front.jpg', pages: 1, by: 'Anil (counter 1)', time: '11:40' },
    { file: 'marksheet-2024.pdf', pages: 4, by: 'Anil (counter 1)', time: '11:44' },
    { file: 'licence-copy.pdf', pages: 2, by: 'Sunita (counter 2)', time: '11:49' },
  ],
  states: {
    completed: { label: 'Completed', tone: 'success' },
    processing: { label: 'Processing', tone: 'info' },
    pending: { label: 'Pending', tone: 'warn' },
    failed: { label: 'Failed', tone: 'danger' },
    online: { label: 'Online', tone: 'success' },
    busy: { label: 'Busy', tone: 'info' },
    offline: { label: 'Offline', tone: 'danger' },
  },
}

export const pricing = {
  eyebrow: 'Pricing',
  title: 'Simple plans for one shop',
  description:
    'Pick the plan that matches how many printers you run. You can change plans as your shop grows.',
  /**
   * PLACEHOLDERS. Nothing here is a real price or a real limit.
   * `amount: null` renders as an explicit "to be decided" state so the page
   * never advertises a number nobody has agreed to.
   */
  plans: [
    {
      name: 'Free Trial',
      amount: 199,
      cadence: 'Full features for a short period so you can test it on your own printers.',
      featured: false,
      cta: { label: 'Start Free Trial', kind: 'signup' },
      features: [
        'One shop account',
        'Up to 2 printers',
        'Print job and queue management',
        'Job history',
        'Email support',
      ],
    },
    {
      name: 'Starter',
      amount: null,
      cadence: 'For a single counter that prints and scans all day.',
      featured: false,
      cta: { label: 'Choose Starter', kind: 'signup' },
      features: [
        'Everything in Free Trial',
        'Up to 3 printers',
        'Document scanning',
        'Printer status view',
        '2 staff sign-ins',
      ],
    },
    {
      name: 'Professional',
      amount: null,
      cadence: 'For busy shops with several machines and staff.',
      featured: true,
      cta: { label: 'Choose Professional', kind: 'signup' },
      features: [
        'Everything in Starter',
        'Up to 10 printers',
        'More staff sign-ins with permissions',
        'Longer job history',
        'Priority support',
      ],
    },
  ],
  /** Printed under the grid so the placeholder state is never mistaken for an offer. */
}

export const faq = {
  eyebrow: 'FAQ',
  title: 'Questions shop owners ask',
  description:
    'Short answers to the things people want to know before they sign up.',
  items: [
    {
      q: 'What is this platform?',
      a: 'It is a web application for cyber cafes and document centres that need to handle printing and scanning from one place. You open it in a browser on any computer in your shop, and it works with the printers and scanners attached to your own machine.',
    },
    {
      q: 'How does printing from the web application work?',
      a: 'You create a job in the dashboard and choose a printer. The job goes to the local agent running on the computer that printer is attached to, and that computer sends it to the device. Your browser never prints directly — the agent is what connects the two.',
    },
    {
      q: 'Do I need to install additional software?',
      a: 'Yes, one thing: the local agent on the Windows computer your printers and scanners are connected to. Everything else runs in the browser. If you have installed a printer driver before, installing the agent is similar.',
    },
    {
      q: 'Can I connect multiple printers?',
      a: 'Yes. You can add more than one printer to the same shop account and pick which one handles each job. How many you can add depends on the plan you use.',
    },
    {
      q: 'Can I use my existing printers?',
      a: 'In most cases yes, because the agent uses the printers your computer already knows about. Very old or unusual models can behave differently, so tell our support team the exact make and model and we will confirm it before you commit.',
    },
    {
      q: 'Does it support document scanners?',
      a: 'Scanning runs through supported scanners connected to the computer running the agent. Scanner support depends on the model and its drivers — check yours with support before you rely on it for daily work.',
    },
    {
      q: 'What happens if my internet connection disconnects?',
      a: 'Your dashboard needs the internet, and jobs reach the local agent over it too. While your line is down, new jobs cannot be sent to printers through the platform. For urgent work, print directly from the computer as you normally would and re-send those jobs later.',
    },
    {
      q: 'Is my document data secure?',
      a: 'Files move between your browser, the platform and the computer running the agent in your shop. We describe what is stored, who can open it and for how long in the Privacy Policy rather than making broad promises here. If you have a specific requirement, ask us before you sign up.',
    },
    {
      q: 'Can multiple employees use one account?',
      a: 'Yes. You can give staff their own sign-ins so you know who sent which job, and control what each person is allowed to do. The number of staff sign-ins depends on your plan.',
    },
    {
      q: 'How do I get technical support?',
      a: 'Email the support address shown in the footer and describe the shop, the printer or scanner model and what you expected to happen. Support response times depend on your plan.',
    },
  ],
}

export const finalCta = {
  title: 'Make Your Cyber Cafe Operations Simpler.',
  description:
    'Bring your printing and scanning workflow into one convenient platform.',
  primary: { label: 'Create Your Account', kind: 'signup' },
  secondary: { label: 'Contact Us', kind: 'contact' },
  note: 'Set up takes one account, one agent install and your existing printers.',
}

export const footer = {
  description:
    'Printing and scanning management for cyber cafes, photocopy shops and document service centres.',
  columns: [
    {
      title: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'How It Works', href: '#how-it-works' },
        { label: 'Compatibility', href: '#compatibility' },
        { label: 'Pricing', href: '#pricing' },
      ],
    },
    {
      title: 'Features',
      links: [
        { label: 'Multi-Printer Management', href: '#features' },
        { label: 'Document Scanning', href: '#features' },
        { label: 'Print Queue', href: '#features' },
        { label: 'Job History', href: '#features' },
      ],
    },
    {
      title: 'Help Center',
      links: [
        { label: 'FAQ', href: '#faq' },
        { label: 'Getting started', kind: 'help' },
        { label: 'Local agent guide', kind: 'help' },
        { label: 'Device support check', kind: 'contact' },
      ],
    },
    {
      title: 'Contact',
      links: [
        { label: 'Email support', kind: 'support' },
        { label: 'Sales enquiry', kind: 'contact' },
        { label: 'Report a problem', kind: 'contact' },
      ],
    },
  ],
  legal: [
    { label: 'Privacy Policy', kind: 'privacy' },
    { label: 'Terms and Conditions', kind: 'terms' },
  ],
}
