const fs = require("fs");
const f = "components/mail-view.tsx";
let s = fs.readFileSync(f, "utf8");
let n = 0;
function swap(find, replace, label) {
  if (s.includes(replace)) { console.log(`  = ${label}`); return; }
  if (!s.includes(find)) { console.error(`  !! ${label}: anchor not found`); process.exit(1); }
  s = s.replace(find, replace); console.log(`  + ${label}`); n++;
}

swap('import { Mail, RefreshCw, Send, X } from "lucide-react";',
     'import { Mail, RefreshCw, Send, Trash2, X } from "lucide-react";',
     "Trash2 icon");

swap('  const [sendResult, setSendResult] = useState("");',
`  const [sendResult, setSendResult] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState("");`,
     "delete state");

swap("  const items = (data?.items || []).filter(",
`  const remove = useCallback(
    async (accountId: string, uid: number) => {
      const key = \`\${accountId}-\${uid}\`;
      setDeleting(key);
      setSendResult("");
      try {
        const response = await fetch("/api/mail/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, uid }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Delete failed.");
        setConfirmDelete("");
        setData((current) =>
          current
            ? { ...current, items: current.items.filter((item) => \`\${item.accountId}-\${item.uid}\` !== key) }
            : current,
        );
        setSendResult("Moved to Trash.");
      } catch (caught) {
        setSendResult(caught instanceof Error ? caught.message : "Delete failed.");
      } finally {
        setDeleting("");
      }
    },
    [],
  );

  const items = (data?.items || []).filter(`,
     "delete handler");

swap(`              >
                Reply
              </button>
            </div>`,
`              >
                Reply
              </button>
              {confirmDelete === \`\${message.accountId}-\${message.uid}\` ? (
                <>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={deleting === \`\${message.accountId}-\${message.uid}\`}
                    onClick={() => void remove(message.accountId, message.uid)}
                  >
                    {deleting === \`\${message.accountId}-\${message.uid}\`
                      ? "Moving…"
                      : "Confirm"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setConfirmDelete("")}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-button danger"
                  aria-label="Move to Trash"
                  onClick={() => setConfirmDelete(\`\${message.accountId}-\${message.uid}\`)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>`,
     "delete button with confirm step");

fs.writeFileSync(f, s);
console.log(`\n${n} edits applied.`);
