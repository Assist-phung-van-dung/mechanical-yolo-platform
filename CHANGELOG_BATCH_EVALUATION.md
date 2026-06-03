# Batch Evaluation Patch

Added a production-friendly Batch Evaluation Center:

- Top navigation menu with Batch Evaluation.
- Async batch job API for uploaded PDFs or random PDFs from `/data/imports/pdfs`.
- Per-PDF results appear as soon as each PDF finishes.
- Options: DPI, confidence, image size, limit, OCR on/off, OCR engine.
- OCR is off by default.
- Two-column viewer: large drawing preview on the left, five field cards on the right.
- AI evaluation: detected/missing/low-confidence/suspicious and quality score.
- Human review: Correct, Wrong box, Missing but should exist, Not present in drawing.
- Final result prioritizes human review; otherwise uses AI estimate.
- CSV export endpoint.
- Send batch item to Label Workspace: promotes the PDF into the library and seeds draft YOLO boxes.
- Frontend field order aligned to production class order:
  0 id_drawing
  1 spare_part_name
  2 spare_part_number
  3 quantity
  4 material
