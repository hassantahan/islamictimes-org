export function onBackdropClick(dialog, dismiss) {
  function onBackdrop(event) {
    if (event.target !== dialog) return false;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
  }

  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (event) => { pressedOutside = onBackdrop(event); });
  dialog.addEventListener("click", (event) => {
    const shouldDismiss = pressedOutside && onBackdrop(event);
    pressedOutside = false;
    if (shouldDismiss) dismiss();
  });
}
