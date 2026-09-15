import unittest
import zipfile
from pathlib import Path
from extract_metadata import extract

class MetadataTests(unittest.TestCase):
    def test_docx_tables(self):
        root = Path(__file__).parent / 'output' / 'metadata-tests'
        root.mkdir(parents=True, exist_ok=True)
        source = root / 'schema.docx'
        with zipfile.ZipFile(source, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>departments: department_id primary key</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
        self.assertIn('department_id primary key', extract(source, '.docx'))

    def test_empty_pdf_rejected(self):
        from pypdf import PdfWriter
        root = Path(__file__).parent / 'output' / 'metadata-tests'
        root.mkdir(parents=True, exist_ok=True)
        source = root / 'empty.pdf'
        writer = PdfWriter(); writer.add_blank_page(width=200, height=200)
        writer.write(source)
        with self.assertRaisesRegex(ValueError, 'No readable text'):
            extract(source, '.pdf')

if __name__ == '__main__': unittest.main()