import io
import unittest
from pathlib import Path
import server

ROOT = Path(__file__).parent


class RichEditorTests(unittest.TestCase):
    def test_admin_index_has_rich_editor_controls(self):
        content = (ROOT / 'admin' / 'index.html').read_text(encoding='utf-8')

        # Check font selector with Bengali and English
        self.assertIn('id="editorFontFamily"', content)
        self.assertIn('Hind Siliguri', content)
        self.assertIn('Libre Baskerville', content)
        self.assertIn('DM Sans', content)

        # Check font size selector
        self.assertIn('id="editorFontSize"', content)

        # Check Bold, Italic, Underline
        self.assertIn('data-cmd="bold"', content)
        self.assertIn('data-cmd="italic"', content)
        self.assertIn('data-cmd="underline"', content)

        # Check Hyperlink
        self.assertIn('id="btnLink"', content)

        # Check Justification buttons (left, center, right, justify)
        self.assertIn('data-cmd="justifyLeft"', content)
        self.assertIn('data-cmd="justifyCenter"', content)
        self.assertIn('data-cmd="justifyRight"', content)
        self.assertIn('data-cmd="justifyFull"', content)

        # Check Bullets and Numbered list
        self.assertIn('data-cmd="insertUnorderedList"', content)
        self.assertIn('data-cmd="insertOrderedList"', content)

        # Check External photo upload button
        self.assertIn('id="btnInsertPhoto"', content)
        self.assertIn('id="editorImageInput"', content)

        # Verify source tool has been removed as requested
        self.assertNotIn('id="btnToggleSource"', content)

        # Check MS Word-style Picture Format Toolbar and resizing tools
        self.assertIn('id="pictureToolbar"', content)
        self.assertIn('data-img-size="25%"', content)
        self.assertIn('data-img-size="50%"', content)
        self.assertIn('data-img-size="100%"', content)
        self.assertIn('id="picWidthSlider"', content)
        self.assertIn('id="btnPicResetSize"', content)
        self.assertIn('data-img-wrap="left"', content)
        self.assertIn('data-img-wrap="center"', content)
        self.assertIn('data-img-wrap="right"', content)
        self.assertIn('id="picStyleSelect"', content)
        self.assertIn('id="btnPicCaption"', content)
        self.assertIn('id="btnPicReplace"', content)
        self.assertIn('id="btnPicDelete"', content)
        self.assertIn('id="imgResizeOverlay"', content)

        # Check WYSIWYG Visual container and Textarea
        self.assertIn('id="docPreviewVisual"', content)
        self.assertIn('id="docPreviewText"', content)

    def test_vlog_html_has_bengali_font_and_rich_styles(self):
        content = (ROOT / 'vlog.html').read_text(encoding='utf-8')

        self.assertIn('Hind+Siliguri', content)
        self.assertIn('.formatted-article-body', content)
        self.assertIn('.formatted-article-body img', content)
        self.assertIn('.formatted-article-body ul', content)

    def test_admin_js_has_toolbar_and_image_editing_logic(self):
        admin_js = (ROOT / 'admin' / 'admin.js').read_text(encoding='utf-8')
        self.assertIn('syncVisualToText', admin_js)
        self.assertIn('setPreviewContent', admin_js)
        self.assertIn('docPreviewVisual', admin_js)
        self.assertIn('editorFontFamily', admin_js)
        self.assertIn('editorFontSize', admin_js)
        self.assertIn('btnInsertPhoto', admin_js)
        self.assertIn('/api/admin/vlogs/upload-body-image', admin_js)

        # Source tool removed from admin.js
        self.assertNotIn('btnToggleSource', admin_js)

        # MS Word picture format logic present
        self.assertIn('selectEditorImage', admin_js)
        self.assertIn('setImageSize', admin_js)
        self.assertIn('positionImageOverlay', admin_js)
        self.assertIn('picWidthSlider', admin_js)
        self.assertIn('picStyleSelect', admin_js)
        self.assertIn('btnPicCaption', admin_js)
        self.assertIn('btnPicReplace', admin_js)
        self.assertIn('btnPicDelete', admin_js)
        self.assertIn('imgResizeOverlay', admin_js)
        self.assertIn('makeImagesDraggable', admin_js)
        self.assertIn('btnPicMoveUp', admin_js)
        self.assertIn('btnPicMoveDown', admin_js)
        self.assertIn('editorDropLine', admin_js)

    def test_server_has_body_image_upload_endpoint(self):
        server_code = (ROOT / 'server.py').read_text(encoding='utf-8')
        self.assertIn("parsed.path == '/api/admin/vlogs/upload-body-image'", server_code)
        self.assertIn("body_", server_code)


if __name__ == '__main__':
    unittest.main()
