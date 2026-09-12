import { downloadFile, downloadZip } from "../api";

interface Props {
  runId: string;
  files: string[];
}

export function FileDownloads({ runId, files }: Props) {
  return (
    <div className="files">
      <div className="file zip-card">
        <div className="fn">All files (.zip)</div>
        <div className="rows">
          {files.length} <small>files</small>
        </div>
        <div className="acts">
          <button type="button" onClick={() => downloadZip(runId)}>
            Download zip
          </button>
        </div>
      </div>
      {files.map((f) => (
        <div key={f} className="file">
          <div className="fn">{f}</div>
          <div className="acts">
            <button type="button" onClick={() => downloadFile(runId, f)}>
              Download
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
