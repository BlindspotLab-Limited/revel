export type IntegrationId = "github" | "linear" | "notion";

export type SetupStep = {
  title: string;
  body: string;
  code?: string;
  link?: { label: string; href: string };
};

export type IntegrationGuide = {
  id: IntegrationId;
  name: string;
  icon: string;
  summary: string;
  envVars: { name: string; required: boolean; hint?: string }[];
  steps: SetupStep[];
  verify: string;
};

export const integrationGuides: IntegrationGuide[] = [
  {
    id: "github",
    name: "GitHub",
    icon: "⎇",
    summary:
      "Download GitHub-flavored Markdown from any report, or push a private Gist when a token is configured.",
    envVars: [
      {
        name: "GITHUB_TOKEN",
        required: false,
        hint: "Only needed for private Gist export. Markdown download works without it.",
      },
    ],
    steps: [
      {
        title: "Download without setup",
        body: "Open any completed report → Export Blueprint → GitHub MD. You get a .github.md file with task checkboxes ready to paste into issues or PRs.",
      },
      {
        title: "Create a personal access token (Gist)",
        body: "In GitHub, go to Settings → Developer settings → Personal access tokens → Fine-grained or classic token.",
        link: {
          label: "GitHub token settings",
          href: "https://github.com/settings/tokens",
        },
      },
      {
        title: "Grant gist scope",
        body: "For classic tokens, enable the gist scope. For fine-grained tokens, choose repository access as needed and allow Gist creation.",
        code: "Scopes: gist",
      },
      {
        title: "Add to Cloudflare",
        body: "In the Cloudflare dashboard → Workers & Pages → revel → Settings → Variables and Secrets, add a Secret:",
        code: "GITHUB_TOKEN=ghp_xxxxxxxx",
      },
      {
        title: "Deploy",
        body: "Select Deploy to publish the new secret (or wait for the next deploy). The Export panel will enable the GitHub Gist button.",
      },
    ],
    verify:
      "On a report page, Export Blueprint → GitHub Gist should create a link to a private gist.",
  },
  {
    id: "linear",
    name: "Linear",
    icon: "◆",
    summary:
      "Creates up to 8 Linear issues from your Action Queue — one issue per top-priority task.",
    envVars: [
      { name: "LINEAR_API_KEY", required: true },
      {
        name: "LINEAR_TEAM_ID",
        required: true,
        hint: "UUID of the team where issues should be created.",
      },
    ],
    steps: [
      {
        title: "Create a Linear API key",
        body: "In Linear: Settings → Account → API → Personal API keys → Create key.",
        link: {
          label: "Linear API settings",
          href: "https://linear.app/settings/api",
        },
      },
      {
        title: "Copy your Team ID",
        body: "Open your team in Linear. The team UUID appears in the URL after /team/, or under Team settings → General.",
        code: "LINEAR_TEAM_ID=<team-uuid>",
      },
      {
        title: "Add secrets on Cloudflare",
        body: "Add both as Secrets under Cloudflare → Workers & Pages → revel → Settings → Variables and Secrets:",
        code: "LINEAR_API_KEY=lin_api_xxxxxxxx\nLINEAR_TEAM_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      },
      {
        title: "Deploy",
        body: "Select Deploy so the API route picks up the new keys.",
      },
      {
        title: "Export from a report",
        body: "Open Mission Control → any completed report → Export Blueprint → Linear. Revel creates issues titled [Revel] <task name> with priority, effort, and outcome in the description.",
      },
    ],
    verify:
      "Linear button in Export panel returns a success message with links to created issues.",
  },
  {
    id: "notion",
    name: "Notion",
    icon: "📝",
    summary:
      "Creates a new page in your Notion database with the full blueprint as page content.",
    envVars: [
      { name: "NOTION_API_KEY", required: true, hint: "Internal integration secret." },
      {
        name: "NOTION_DATABASE_ID",
        required: true,
        hint: "32-char ID from your database URL (with or without hyphens).",
      },
      {
        name: "NOTION_TITLE_PROPERTY",
        required: false,
        hint: 'Defaults to "Name". Set this if your title column has a different name.',
      },
    ],
    steps: [
      {
        title: "Create a Notion integration",
        body: "At notion.so/my-integrations → New integration → name it Revel → copy the Internal Integration Secret.",
        link: {
          label: "Notion integrations",
          href: "https://www.notion.so/my-integrations",
        },
      },
      {
        title: "Create or pick a database",
        body: "Use an existing project database or create a new full-page database. It needs at least one Title property (default name: Name).",
      },
      {
        title: "Share the database with Revel",
        body: "Open the database → ••• menu → Connections → connect your Revel integration. Without this step, the API returns 404.",
      },
      {
        title: "Copy the database ID",
        body: "From the database URL: notion.so/workspace/DATABASE_ID?v=... — copy the 32-character ID.",
        code: "NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      {
        title: "Add secrets on Cloudflare",
        body: "Add as Secrets under Cloudflare → Workers & Pages → revel → Settings → Variables and Secrets:",
        code: "NOTION_API_KEY=secret_xxxxxxxx\nNOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nNOTION_TITLE_PROPERTY=Name",
      },
      {
        title: "Deploy and export",
        body: "Deploy, then on any report use Export Blueprint → Notion. A new page opens with score in the title and markdown content in the body.",
      },
    ],
    verify:
      "Notion button returns a link to the newly created page in your database.",
  },
];