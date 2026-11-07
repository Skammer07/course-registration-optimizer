/** Save a Blob as a file download (cookies rule out a plain <a href> for protected files). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // give the browser a moment to start the download before releasing the URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
