import type { ComplianceCheck } from "../types";

interface Props {
  checks: ComplianceCheck[];
  passed: boolean;
  qaObjects?: Record<string, unknown[]>;
}

export function ValidationCards({ checks, passed, qaObjects }: Props) {
  const byTable = new Map<string, ComplianceCheck[]>();
  for (const c of checks) {
    const key = c.name.split(":")[0].split(".")[0];
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key)!.push(c);
  }

  const cards =
    byTable.size > 0
      ? [...byTable.entries()]
      : qaObjects
        ? Object.keys(qaObjects).map((k) => [k, []] as [string, ComplianceCheck[]])
        : [];

  return (
    <>
      <div className="vcards">
        {cards.map(([name, tableChecks]) => {
          const ok =
            tableChecks.length === 0
              ? true
              : tableChecks.every((c) => c.pass);
          const count = tableChecks.length || (qaObjects?.[name]?.length ?? 0);
          return (
            <div key={name} className={`vc ${ok ? "ok" : "bad"}`}>
              <div className="big">
                {name}: {ok ? "PASS" : "FAIL"}
              </div>
              <div className="chk">{count} checks</div>
            </div>
          );
        })}
      </div>
      <div className={`banner ${passed ? "ok" : "bad"}`} style={{ marginTop: 12 }}>
        {passed
          ? "All integrity checks passed. Files ready for download."
          : "Validation FAILED — no files offered. Fix the model and rerun."}
      </div>
    </>
  );
}
