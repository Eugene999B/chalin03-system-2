import { useEffect } from "react";

const PRODUCTS_PATH_PATTERN = /^\/products\/?$/;
const EDIT_HEADING = "Edit Product";

function isProductsPage() {
  return PRODUCTS_PATH_PATTERN.test(window.location.pathname);
}

function findVisibleProductEditor() {
  const headings = Array.from(
    document.querySelectorAll(".boss-mobile-fix h2")
  );
  const heading = headings.find(
    (candidate) => candidate.textContent?.trim() === EDIT_HEADING
  );

  return heading?.closest("form") || null;
}

function revealProductEditor(editor) {
  const scrollContainer = editor.closest(".premium-main");

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const targetTop =
      scrollContainer.scrollTop + editorRect.top - containerRect.top - 18;

    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  } else {
    editor.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  window.setTimeout(() => {
    editor.querySelector('input[name="name"]')?.focus({ preventScroll: true });
  }, 380);
}

export default function ProductsPageShellRepair() {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return undefined;

    let lastEditor = null;
    let firstFrame = null;
    let secondFrame = null;

    function cancelScheduledReveal() {
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
        firstFrame = null;
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
        secondFrame = null;
      }
    }

    function inspectEditorState() {
      if (!isProductsPage()) {
        lastEditor = null;
        cancelScheduledReveal();
        return;
      }

      const editor = findVisibleProductEditor();
      if (!editor) {
        lastEditor = null;
        cancelScheduledReveal();
        return;
      }

      if (editor === lastEditor) return;
      lastEditor = editor;
      cancelScheduledReveal();

      firstFrame = window.requestAnimationFrame(() => {
        firstFrame = null;
        secondFrame = window.requestAnimationFrame(() => {
          secondFrame = null;
          revealProductEditor(editor);
        });
      });
    }

    const observer = new MutationObserver(inspectEditorState);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    inspectEditorState();

    return () => {
      observer.disconnect();
      cancelScheduledReveal();
    };
  }, []);

  return (
    <style>{`
      /* The premium sidebar uses z-index 1000. Legacy receipt/product modals
         previously used z-index 50, so the sidebar covered their left edge. */
      .premium-layout .modal-backdrop {
        z-index: 5000 !important;
        overscroll-behavior: contain;
      }

      .premium-layout .modal-backdrop .receipt-modal {
        max-height: calc(100dvh - 60px);
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      @media (max-width: 920px) {
        .premium-layout .modal-backdrop {
          padding: 12px !important;
        }

        .premium-layout .modal-backdrop .receipt-modal {
          max-height: calc(100dvh - 24px);
        }
      }
    `}</style>
  );
}
