import { useEffect, useRef, type RefObject } from "react";

export const NATIVE_BACK_EVENT = "animesoul-native-back";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let bodyLockCount = 0;
let bodyOverflowBeforeModal = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeModal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeModal;
}

function isTopmostDialog(dialog: HTMLElement) {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return dialogs.length > 0 && dialogs.item(dialogs.length - 1) === dialog;
}

/**
 * Gives portal and in-tree dialogs the same Escape/native-back, focus trap,
 * scroll locking and focus restoration behaviour.
 */
export function useModalAccessibility(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostDialog(dialog)) return;
      const first = dialog.querySelector<HTMLElement>("[autofocus], " + FOCUSABLE_SELECTOR);
      (first ?? dialog).focus({ preventScroll: true });
    });

    const closeTopmost = (event: Event) => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostDialog(dialog)) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
      return true;
    };

    const onNativeBack = (event: Event) => {
      closeTopmost(event);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostDialog(dialog)) return;
      if (event.key === "Escape") {
        closeTopmost(event);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => element.getClientRects().length > 0 && !element.hasAttribute("inert"));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    lockBodyScroll();
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(NATIVE_BACK_EVENT, onNativeBack);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(NATIVE_BACK_EVENT, onNativeBack);
      unlockBodyScroll();
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus({ preventScroll: true }));
      }
    };
  }, [dialogRef, open]);
}
