(() => {
  const THEME_COOKIE = "cloud-home_theme";
  const getCookie = () => document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE}=`))
    ?.split("=")[1];
  const setTheme = (theme) => {
    const normalized = theme === "oled" ? "oled" : "noir";
    document.cookie = `${THEME_COOKIE}=${normalized}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const owuiTheme = normalized === "oled" ? "oled-dark" : "dark";
    if (localStorage.theme !== owuiTheme) {
      localStorage.theme = owuiTheme;
      document.documentElement.classList.toggle("oled-dark", normalized === "oled");
      document.documentElement.classList.toggle("dark", normalized !== "oled");
    }
  };
  setTheme(getCookie() || (localStorage.theme === "oled-dark" ? "oled" : "noir"));

  class CloudHomeSwitcher extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: "open" });
      const host = window.location.hostname;
      root.innerHTML = `
        <style>
          :host{position:fixed;left:14px;bottom:14px;z-index:2147483000;font-family:Inter,-apple-system,sans-serif;color:#f5f5f7}
          button,a{font:inherit;color:inherit}.trigger{width:40px;height:40px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(10,10,12,.9);box-shadow:0 12px 35px rgba(0,0,0,.45);backdrop-filter:blur(18px);cursor:pointer;transition:.16s ease}.trigger:hover{transform:translateY(-2px);background:#17171a}.dots{display:grid;grid-template-columns:repeat(2,4px);gap:4px}.dots i{width:4px;height:4px;border-radius:50%;background:#a6e22e}.menu{position:absolute;left:0;bottom:50px;width:205px;padding:7px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(10,10,12,.96);box-shadow:0 24px 70px rgba(0,0,0,.6);backdrop-filter:blur(24px);transform-origin:left bottom;animation:in .15s ease}.menu[hidden]{display:none}.label{padding:8px 9px 6px;color:#818188;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.menu a,.theme{display:flex;align-items:center;gap:10px;width:100%;min-height:39px;padding:6px 8px;border:0;border-radius:9px;background:transparent;text-decoration:none;cursor:pointer}.menu a:hover,.theme:hover{background:#1a1a1e}.glyph{width:27px;height:27px;display:grid;place-items:center;border-radius:8px;background:#a6e22e;color:#050505;font-weight:800}.glyph.files{background:#ae81ff}.glyph.ai{background:#f92672}.theme{border-top:1px solid rgba(255,255,255,.08);margin-top:5px;padding-top:9px;color:#b6b6bc}.theme span:first-child{width:27px;text-align:center}@keyframes in{from{opacity:0;transform:translateY(6px) scale(.98)}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
        </style>
        <button class="trigger" aria-label="Switch Cloud Files app" aria-expanded="false"><span class="dots"><i></i><i></i><i></i><i></i></span></button>
        <nav class="menu" hidden>
          <div class="label">Cloud Files</div>
          <a href="http://${host}:8090"><span class="glyph">▶</span><span>Cloud Media</span></a>
          <a href="http://${host}:8082"><span class="glyph files">F</span><span>Files</span></a>
          <a href="${window.location.href}"><span class="glyph ai">AI</span><span>Open WebUI</span></a>
          <button class="theme"><span>◐</span><span>Toggle OLED mode</span></button>
        </nav>`;
      const trigger = root.querySelector(".trigger");
      const menu = root.querySelector(".menu");
      trigger.addEventListener("click", () => {
        menu.hidden = !menu.hidden;
        trigger.setAttribute("aria-expanded", String(!menu.hidden));
      });
      root.querySelector(".theme").addEventListener("click", () => {
        setTheme(getCookie() === "oled" ? "noir" : "oled");
        menu.hidden = true;
      });
      document.addEventListener("pointerdown", (event) => {
        if (!event.composedPath().includes(this)) menu.hidden = true;
      });
    }
  }
  customElements.define("cloud-home-switcher", CloudHomeSwitcher);
  const mount = () => document.body.appendChild(document.createElement("cloud-home-switcher"));
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mount) : mount();
})();
