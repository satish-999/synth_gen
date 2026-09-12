import type { PipelineStage } from "../types";

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "datasets", label: "Datasets" },
  { id: "options", label: "Options" },
  { id: "generate", label: "Generate" },
  { id: "validate", label: "Validate" },
  { id: "files", label: "Files" },
];

const ORDER = STAGES.map((s) => s.id);

interface Props {
  current: PipelineStage;
  failed?: boolean;
}

export function PipelineRail({ current, failed }: Props) {
  const idx = ORDER.indexOf(current);

  return (
    <div className="rail">
      {STAGES.map((stage, i) => {
        let cls = "stage";
        if (failed && stage.id === "validate") cls += " failed";
        else if (i < idx) cls += " done";
        else if (i === idx) cls += " active";

        return (
          <span key={stage.id} style={{ display: "contents" }}>
            <div className={cls}>
              <span className="dot" />
              {stage.label}
            </div>
            {i < STAGES.length - 1 && <div className="link" />}
          </span>
        );
      })}
    </div>
  );
}
