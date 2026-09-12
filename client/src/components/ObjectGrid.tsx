import type { TableInfo } from "../types";

interface Props {
  tables: Record<string, TableInfo>;
  selected: Set<string>;
  autoIncluded: string[];
  onToggle: (name: string) => void;
}

export function ObjectGrid({ tables, selected, autoIncluded, onToggle }: Props) {
  const names = Object.keys(tables).sort();

  return (
    <>
      <div className="obj-grid">
        {names.map((name) => {
          const info = tables[name];
          const on = selected.has(name);
          const auto = autoIncluded.includes(name);
          return (
            <label key={name} className={`obj${on ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(name)}
              />
              <div>
                <div className="nm">{name}</div>
                <div className="ds">
                  PK: {info.pk.join(", ") || "—"}
                  {info.parents.length > 0 && ` · FK → ${info.parents.join(", ")}`}
                </div>
                {info.sizing && <div className="tag">SIZING · rows derived</div>}
                {auto && !selected.has(name) && <div className="tag">auto-included</div>}
              </div>
            </label>
          );
        })}
      </div>
      {autoIncluded.length > 0 && (
        <div className="autonote">
          Auto-included FK parents: {autoIncluded.join(", ")}
        </div>
      )}
    </>
  );
}
