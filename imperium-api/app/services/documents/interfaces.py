from abc import ABC, abstractmethod
from typing import Dict, Any, List


class DocumentRenderer(ABC):
    @abstractmethod
    def render_pdf(self, data: Dict[str, Any], output_path: str) -> bool:
        """Generates a branded PDF document from data and writes to output_path."""
        pass


class ExcelExporter(ABC):
    @abstractmethod
    def export_to_excel(self, data: Dict[str, Any], output_path: str) -> bool:
        """Generates a highly-formatted Excel workbook and writes to output_path."""
        pass


class TextExtractor(ABC):
    @abstractmethod
    def extract_text(self, file_path: str) -> str:
        """Extracts text content safely from the document file."""
        pass


class PDFMergeService(ABC):
    @abstractmethod
    def merge_pdfs(self, pdf_paths: List[str], output_path: str) -> bool:
        """Merges multiple PDF files into a single output PDF."""
        pass
