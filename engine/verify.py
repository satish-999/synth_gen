"""Phase 1 verification: create demo model, generate, validate compliance."""
import glob
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def run(cmd):
    print(f"\n>> {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        sys.exit(result.returncode)


def main():
    py = sys.executable
    run([py, "create_demo_model.py"])
    run([py, "synthgen.py", "--model", "data_model_demo.xlsx", "--config", "run_config_demo.yaml"])

    snapshots = sorted(glob.glob(str(ROOT / "output/run_retail_demo/model_snapshot_*.json")))
    if not snapshots:
        print("ERROR: no model snapshot found")
        sys.exit(1)

    run([py, "validate_compliance.py", "--snapshot", snapshots[-1],
         "--data", "output/run_retail_demo"])
    print("\nPhase 1 verification: PASS")


if __name__ == "__main__":
    main()
