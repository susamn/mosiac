fetch("data/manifest.json")
  .then((r) => r.json())
  .then((d) => { document.getElementById("manifest-result").textContent = JSON.stringify(d); });

fetch("data/nested/deep.json")
  .then((r) => r.json())
  .then((d) => { document.getElementById("nested-result").textContent = JSON.stringify(d); });
