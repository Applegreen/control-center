export type AppLink = {
  id: string;
  name: string;
  description: string;
  href: string;
  // Checked server-side over loopback, so no CORS and no public round trip.
  check: string;
};

export const APP_LINKS: AppLink[] = [
  {
    id: "board",
    name: "Vikunja",
    description: "Boards, Gantt timelines and production schedules",
    href: "https://board.digitalcharacters.africa",
    check: "http://127.0.0.1:3456",
  },
  {
    id: "invoices",
    name: "Invoice Ninja",
    description: "Invoices, quotes and client billing",
    href: "https://invoices.digitalcharacters.africa",
    check: "http://127.0.0.1:8012",
  },
  {
    id: "chat",
    name: "Open WebUI",
    description: "Chat with the local model, with visible reasoning",
    href: "https://chat.digitalcharacters.africa",
    check: "http://127.0.0.1:8090",
  },
];
