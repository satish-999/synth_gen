"""Extract bounded document text; uploaded content is never executed."""
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MAX_CHARS = 100_000

def extract(path, extension):
    if extension == '.docx':
        with zipfile.ZipFile(path) as archive:
            if sum(i.file_size for i in archive.infolist()) > 25_000_000:
                raise ValueError('Expanded Word document exceeds 25 MB.')
            xml = archive.read('word/document.xml')
            if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
                raise ValueError('Document contains unsupported XML entities.')
            root = ElementTree.fromstring(xml)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            text = '\n'.join(' '.join(t.text or '' for t in p.findall('.//w:t', ns))
                             for p in root.findall('.//w:p', ns))
    elif extension == '.pdf':
        from pypdf import PdfReader
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError('Upload an unencrypted PDF.')
        if len(reader.pages) > 100:
            raise ValueError('PDF exceeds 100 pages. Upload the relevant metadata sections.')
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or '')
            if sum(map(len, parts)) > MAX_CHARS:
                raise ValueError('Document exceeds 100,000 characters.')
        text = '\n'.join(parts)
    else:
        text = Path(path).read_text(encoding='utf-8-sig')
    if not text.strip():
        raise ValueError('No readable text found. Scanned PDFs need OCR before upload.')
    if len(text) > MAX_CHARS:
        raise ValueError('Document exceeds 100,000 characters. Upload a smaller section.')
    return text

if __name__ == '__main__':
    try:
        print(json.dumps({'text': extract(sys.argv[1], sys.argv[2])}))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)