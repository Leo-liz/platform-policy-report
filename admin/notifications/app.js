const state = { csrf: "", catalog: null, recipients: [], rules: [], dispatches: [], audits: [] };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);

function toast(message) { const el = $("#toast"); el.textContent = message; el.style.display = "block"; setTimeout(() => { el.style.display = "none"; }, 3500); }
async function api(action, options = {}) {
  const separator = action.indexOf("&");
  const actionName = separator >= 0 ? action.slice(0, separator) : action;
  const extraQuery = separator >= 0 ? `&${action.slice(separator + 1)}` : "";
  const response = await fetch(`/api/admin?action=${encodeURIComponent(actionName)}${extraQuery}`, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(state.csrf ? { "X-CSRF-Token": state.csrf } : {}), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function apply(next) {
  Object.assign(state, next);
  if (next.csrf_token) state.csrf = next.csrf_token;
  render();
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}">暂无数据</td></tr>`}</tbody></table>`;
}

function render() {
  if (!state.catalog) return;
  const platformLabel = Object.fromEntries(state.catalog.platforms.map((x) => [x.code, x.label]));
  const tagLabel = Object.fromEntries(state.catalog.primary_tags.map((x) => [x.code, x.label]));
  const recipientLabel = Object.fromEntries(state.recipients.map((x) => [x.id, x.display_name]));
  $("#rule-recipient").innerHTML = state.recipients.filter((x) => x.enabled).map((x) => `<option value="${esc(x.id)}">${esc(x.display_name)}</option>`).join("");
  $("#rule-platform").innerHTML = `<option value="*">全部平台（含未来平台）</option>` + state.catalog.platforms.map((x) => `<option value="${esc(x.code)}">${esc(x.label)}</option>`).join("");
  $("#rule-tag").innerHTML = `<option value="*">全部主标签（含未来标签）</option>` + state.catalog.primary_tags.map((x) => `<option value="${esc(x.code)}">${esc(x.label)}</option>`).join("");
  $("#recipient-list").innerHTML = table(["显示名", "userId", "来源", "状态", "操作"], state.recipients.map((x) => `<tr><td>${esc(x.display_name)}</td><td>${esc(x.dingtalk_user_id)}</td><td>${esc(x.source)}</td><td><span class="badge ${x.enabled ? "" : "off"}">${x.enabled ? "启用" : "停用"}</span></td><td><button class="mini edit-recipient" data-id="${esc(x.id)}">编辑</button><button class="mini toggle-recipient" data-id="${esc(x.id)}" data-enabled="${!x.enabled}">${x.enabled ? "停用" : "启用"}</button></td></tr>`));
  $("#rule-list").innerHTML = table(["收件人", "平台", "主标签", "状态", "操作"], state.rules.map((x) => `<tr><td>${esc(recipientLabel[x.recipient_id] || "未知收件人")}</td><td>${esc(x.platform_code === "*" ? "全部平台" : platformLabel[x.platform_code] || x.platform_code)}</td><td>${esc(x.primary_tag_code === "*" ? "全部主标签" : tagLabel[x.primary_tag_code] || x.primary_tag_code)}</td><td><span class="badge ${x.enabled ? "" : "off"}">${x.enabled ? "启用" : "停用"}</span></td><td><button class="mini toggle-rule" data-id="${esc(x.id)}" data-enabled="${!x.enabled}">${x.enabled ? "停用" : "启用"}</button></td></tr>`));
  $("#match-preview").innerHTML = state.recipients.map((recipient) => {
    const rules = state.rules.filter((rule) => rule.recipient_id === recipient.id && rule.enabled);
    const descriptions = rules.map((rule) => `${rule.platform_code === "*" ? "全部平台" : platformLabel[rule.platform_code]} × ${rule.primary_tag_code === "*" ? "全部主标签" : tagLabel[rule.primary_tag_code]}`);
    return `<article class="preview-card"><h3>${esc(recipient.display_name)}</h3><p>${recipient.enabled ? "已启用" : "已停用"} · ${rules.length} 条有效规则</p><ul>${descriptions.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>当前不会收到业务通知</li>"}</ul><button class="mini test-notification" data-id="${esc(recipient.id)}">发送测试通知</button></article>`;
  }).join("") || "暂无收件人";
  $("#dispatch-list").innerHTML = `<h3>发送记录</h3>` + table(["日期", "收件人", "事件数", "状态", "task_id", "失败分类"], state.dispatches.map((x) => `<tr><td>${esc(x.report_date)}</td><td>${esc(x.display_name)}</td><td>${esc(x.event_count)}</td><td>${esc(x.status)}</td><td>${esc(x.task_id || "")}</td><td>${esc(x.failure_type || "")}</td></tr>`));
  $("#audit-list").innerHTML = `<h3>操作记录</h3>` + table(["时间", "操作", "对象", "详情"], state.audits.map((x) => `<tr><td>${esc(x.created_at)}</td><td>${esc(x.action)}</td><td>${esc(x.target_type)}</td><td>${esc(JSON.stringify(x.detail_json || {}))}</td></tr>`));
  bindRowActions();
}

async function refresh() { apply(await api("session")); }
function bindRowActions() {
  document.querySelectorAll(".edit-recipient").forEach((button) => button.onclick = () => { const x = state.recipients.find((item) => item.id === button.dataset.id); if (!x) return; $("#recipient-id").value = x.id; $("#recipient-name").value = x.display_name; $("#recipient-userid").value = x.dingtalk_user_id; $("#recipient-source").value = x.source; $("#recipient-enabled").checked = x.enabled; window.scrollTo({ top: 0, behavior: "smooth" }); });
  document.querySelectorAll(".toggle-recipient").forEach((button) => button.onclick = async () => apply(await api("toggle_recipient", { method: "POST", body: JSON.stringify({ id: button.dataset.id, enabled: button.dataset.enabled === "true" }) })));
  document.querySelectorAll(".toggle-rule").forEach((button) => button.onclick = async () => apply(await api("toggle_rule", { method: "POST", body: JSON.stringify({ id: button.dataset.id, enabled: button.dataset.enabled === "true" }) })));
  document.querySelectorAll(".test-notification").forEach((button) => button.onclick = async () => { if (!confirm("将向环境变量指定的测试 userId 真实发送一条三平台聚合测试通知，是否继续？")) return; const result = await api("test_notification", { method: "POST", body: JSON.stringify({ recipient_id: button.dataset.id }) }); toast(`测试通知状态：${result.status}，task_id：${result.task_id || "未返回"}`); await refresh(); });
}

$("#login-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api("login", { method: "POST", body: JSON.stringify({ password: $("#admin-password").value }) }); state.csrf = result.csrf_token; $("#login-panel").hidden = true; $("#app").hidden = false; await refresh(); } catch (error) { toast(error.message); } };
$("#logout").onclick = async () => { await api("logout", { method: "POST", body: "{}" }); location.reload(); };
$("#directory-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`directory&q=${encodeURIComponent($("#directory-query").value)}`); $("#directory-results").innerHTML = result.people.map((person) => `<button type="button" data-name="${esc(person.display_name)}" data-userid="${esc(person.dingtalk_user_id)}">${esc(person.display_name)} · ${esc(person.dingtalk_user_id)}</button>`).join("") || "未找到，可手工填写"; $("#directory-results").querySelectorAll("button").forEach((button) => button.onclick = () => { $("#recipient-name").value = button.dataset.name; $("#recipient-userid").value = button.dataset.userid; $("#recipient-source").value = "directory"; }); } catch (error) { toast(`${error.message}；可改为手工填写 userId`); } };
$("#recipient-form").onsubmit = async (event) => { event.preventDefault(); try { apply(await api("save_recipient", { method: "POST", body: JSON.stringify({ id: $("#recipient-id").value, display_name: $("#recipient-name").value, dingtalk_user_id: $("#recipient-userid").value, source: $("#recipient-source").value, enabled: $("#recipient-enabled").checked }) })); event.target.reset(); $("#recipient-enabled").checked = true; $("#recipient-source").value = "manual"; toast("收件人已保存"); } catch (error) { toast(error.message); } };
$("#rule-form").onsubmit = async (event) => { event.preventDefault(); try { apply(await api("save_rule", { method: "POST", body: JSON.stringify({ id: $("#rule-id").value, recipient_id: $("#rule-recipient").value, platform_code: $("#rule-platform").value, primary_tag_code: $("#rule-tag").value, enabled: $("#rule-enabled").checked }) })); toast("订阅规则已保存"); } catch (error) { toast(error.message); } };
document.querySelectorAll(".tab").forEach((tab) => tab.onclick = () => { document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === tab)); document.querySelectorAll(".tab-panel").forEach((x) => x.hidden = x.id !== tab.dataset.target); });

try { const result = await api("session"); $("#login-panel").hidden = true; $("#app").hidden = false; apply(result); } catch { /* unauthenticated is the normal first visit */ }
