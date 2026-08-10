const presets = [
  { name: "Aching", detail: "Dull, persistent pain", color: "#8d6aac" },
  { name: "Sharp", detail: "Sudden or stabbing", color: "#e57867" },
  { name: "Burning", detail: "Hot or tingling", color: "#e5a74f" },
  { name: "Numbness", detail: "Reduced sensation", color: "#5ca5a7" },
];

const list = document.querySelector("#pain-list");
const template = document.querySelector("#pain-template");
const figures = document.querySelector(".figures");
let selectedColor = presets[0].color;

function addPainType(pain, custom = false) {
  const item = template.content.firstElementChild.cloneNode(true);
  const name = item.querySelector(".pain-name");
  const color = item.querySelector(".color-input");
  item.style.setProperty("--item-color", pain.color);
  name.value = pain.name;
  color.value = pain.color;
  item.querySelector(".pain-detail").textContent = pain.detail || "Custom pain type";
  if (custom) item.classList.add("custom");

  item.querySelector(".swatch").addEventListener("click", () => selectPain(item));
  color.addEventListener("input", () => {
    item.style.setProperty("--item-color", color.value);
    if (item.classList.contains("active")) selectedColor = color.value;
  });
  item.querySelector(".remove-button").addEventListener("click", () => {
    item.remove();
    updateCount();
    if (!list.querySelector(".active")) selectPain(list.firstElementChild);
  });
  list.append(item);
  if (!list.querySelector(".active")) selectPain(item);
  updateCount();
}

function selectPain(item) {
  list.querySelectorAll(".pain-item").forEach((row) => row.classList.remove("active"));
  item.classList.add("active");
  selectedColor = item.querySelector(".color-input").value;
}

function updateCount() {
  const count = list.children.length;
  document.querySelector(".selected-count").textContent = `${count} ${count === 1 ? "type" : "types"}`;
}

presets.forEach((preset) => addPainType(preset));

document.querySelector("#add-pain").addEventListener("click", () => {
  addPainType({ name: "New pain type", color: "#6381b5" }, true);
  const input = list.lastElementChild.querySelector(".pain-name");
  input.focus();
  input.select();
});

document.querySelectorAll(".regions > *").forEach((region) => {
  region.addEventListener("click", () => {
    if (region.classList.contains("painted") && region.dataset.color === selectedColor) {
      region.classList.remove("painted");
      region.style.fill = "transparent";
      delete region.dataset.color;
      return;
    }
    region.classList.add("painted");
    region.style.fill = selectedColor;
    region.dataset.color = selectedColor;
  });
});

document.querySelectorAll(".view-toggle button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".view-toggle button").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active);
    });
    figures.className = `figures${button.dataset.view === "both" ? "" : ` show-${button.dataset.view}`}`;
  });
});

document.querySelector(".save-button").addEventListener("click", (event) => {
  event.currentTarget.firstChild.textContent = "Body map saved ";
  setTimeout(() => { event.currentTarget.firstChild.textContent = "Save body map "; }, 1600);
});
