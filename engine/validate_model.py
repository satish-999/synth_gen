"""Validate a data model workbook using synthgen.validate_model."""
import sys
from synthgen import parse_workbook, validate_model


def main():
    path = sys.argv[1]
    try:
        model = parse_workbook(path)
        validate_model(model)
        print("PASS")
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
