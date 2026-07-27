const status = document.querySelector("#status");
const contextList = document.querySelector("#context");
const pluginName = document.querySelector("#plugin-name");
const contributionName = document.querySelector("#contribution-name");
let initialized = false;

window.addEventListener("message", (event) => {
  if (initialized || event.data?.type !== "translunar.plugin.initialize")
    return;
  const { nonce, version } = event.data;
  const port = event.ports[0];
  if (version !== 1 || typeof nonce !== "string" || !port) return;
  initialized = true;
  port.onmessage = ({ data }) => {
    if (data?.version !== 1) return;
    if (data.type === "result" && data.id === "context-1") {
      pluginName.textContent = String(data.result?.pluginName ?? "Unknown");
      contributionName.textContent = String(
        data.result?.contributionName ?? "Unknown",
      );
      contextList.hidden = false;
      status.textContent = "Connected";
    } else if (data.type === "error" || data.type === "revoked") {
      status.textContent = "Unavailable";
    }
  };
  port.start();
  port.postMessage({ version: 1, type: "ready", nonce });
  port.postMessage({
    version: 1,
    type: "request",
    id: "context-1",
    method: "panel.context",
    params: {},
  });
});
