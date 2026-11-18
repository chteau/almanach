// Copy buttons on code blocks: data-copy names the element whose text is copied.
for (const button of document.querySelectorAll("[data-copy]")) {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    const text = document.getElementById(button.dataset.copy)?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = button.dataset.done;
    } catch {
      return;
    }
    setTimeout(() => { button.textContent = label; }, 1600);
  });
}
