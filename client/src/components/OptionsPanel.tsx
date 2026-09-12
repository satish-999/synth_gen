import type { OutputFormat, TableInfo } from "../types";

const DEFAULT_SIZING_ROWS = 50;
const DEFAULT_PARENT_ROWS = 200;

interface Props {
  picked: string[];
  tables: Record<string, TableInfo>;
  rows: Record<string, number>;
  seed: number;
  formats: OutputFormat[];
  onRowChange: (table: string, value: number) => void;
  onSeedChange: (seed: number) => void;
  onFormatsChange: (formats: OutputFormat[]) => void;
}

/** Row counts only for tables the user explicitly selected. */
export function OptionsPanel({
  picked,
  tables,
  rows,
  seed,
  formats,
  onRowChange,
  onSeedChange,
  onFormatsChange,
}: Props) {
  const toggleFormat = (f: OutputFormat) => {
    if (formats.includes(f)) {
      const next = formats.filter((x) => x !== f);
      if (next.length > 0) onFormatsChange(next);
    } else {
      onFormatsChange([...formats, f]);
    }
  };

  return (
    <div className="opts">
      {picked.map((t) => {
        const sizing = tables[t]?.sizing;
        const defaultRows = sizing ? DEFAULT_SIZING_ROWS : DEFAULT_PARENT_ROWS;
        return (
          <div key={t}>
            <label>
              {t} rows
              {sizing ? " (fixed count)" : ""}
            </label>
            <input
              type="number"
              min={1}
              value={rows[t] ?? defaultRows}
              onChange={(e) => onRowChange(t, Number(e.target.value))}
            />
          </div>
        );
      })}
      <div>
        <label>Seed (same seed = identical data)</label>
        <input
          type="number"
          value={seed}
          onChange={(e) => onSeedChange(Number(e.target.value))}
        />
      </div>
      <div>
        <label>Output format</label>
        <div className="format-chips">
          {(["csv", "xlsx"] as OutputFormat[]).map((f) => (
            <label key={f} className={`chip${formats.includes(f) ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={formats.includes(f)}
                onChange={() => toggleFormat(f)}
              />
              {f.toUpperCase()}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
