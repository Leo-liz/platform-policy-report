import { normalizeScopeSelection, scopeSelectionText, toggleScopeSelection } from "./scope-picker.js";

const state = { csrf: "", catalog: null, recipients: [], rules: [], dispatches: [], audits: [], capabilities: {} };
const draft = { platform_codes: ["*"], primary_tag_codes: ["*"] };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.style.display = "block";
  setTimeout(() => { element.style.display = "none"; }, 3500);
}

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
  return `<table><thead><tr>${headers.map((heading) => `<th>${esc(heading)}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}">暂无数据</td></tr>`}</tbody></table>`;
}

function ruleScopes(rule, plural, legacy) {
  return normalizeScopeSelection(rule?.[plural] ?? rule?.[legacy] ?? "*");
}

function scopeLabels(values, labels, allText) {
  const selected = normalizeScopeSelection(values);
  if (selected.includes("*")) return `<span class="scope-chip">${esc(allText)}</span>`;
  return `<div class="scope-list">${selected.map((value) => `<span class="scope-chip">${esc(labels[value] || value)}</span>`).join("")}</div>`;
}

function renderScopePicker(element, { values, options, labels, allText, onChange }) {
  const selected = normalizeScopeSelection(values);
  const choices = [{ code: "*", label: allText }, ...options];
  element.innerHTML = `
    <button class="scope-picker-trigger" type="button" aria-expanded="false">${esc(scopeSelectionText(selected, labels, allText))}</button>
    <div class="scope-picker-menu" hidden>
      ${choices.map((choice) => `<label class="scope-option ${choice.code === "*" ? "all" : ""}"><input type="checkbox" value="${esc(choice.code)}" ${selected.includes(choice.code) ? "checked" : ""} />${esc(choice.label)}</label>`).join("")}
    </div>`;
  const trigger = element.querySelector(".scope-picker-trigger");
  const menu = element.querySelector(".scope-picker-menu");
  trigger.onclick = () => {
    const opening = menu.hidden;
    document.querySelectorAll(".scope-picker-menu").forEach((candidate) => { candidate.hidden = true; });
    document.querySelectorAll(".scope-picker-trigger").forEach((candidate) => candidate.setAttribute("aria-expanded", "false"));
    menu.hidden = !opening;
    trigger.setAttribute("aria-expanded", String(opening));
  };
  menu.querySelectorAll("input").forEach((input) => {
    input.onchange = () => onChange(toggleScopeSelection(selected, input.value, input.checked));
  });
}

function renderRulePickers() {
  if (!state.catalog) return;
  const platformLabels = Object.fromEntries(state.catalog.platforms.map((item) => [item.code, item.label]));
  const tagLabels = Object.fromEntries(state.catalog.primary_tags.map((item) => [item.code, item.label]));
  renderScopePicker($("#rule-platform"), {
    values: draft.platform_codes,
    options: state.catalog.platforms,
    labels: platformLabels,
    allText: "全部平台（含未来平台）",
    onChange: (values) => { draft.platform_codes = values; renderRulePickers(); },
  });
  renderScopePicker($("#rule-tag"), {
    values: draft.primary_tag_codes,
    options: state.catalog.primary_tags,
    labels: tagLabels,
    allText: "全部主标签（含未来标签）",
    onChange: (values) => { draft.primary_tag_codes = values; renderRulePickers(); },
  });
}

function resetRuleForm() {
  $("#rule-id").value = "";
  $("#rule-enabled").checked = true;
  draft.platform_codes = ["*"];
  draft.primary_tag_codes = ["*"];
  $("#cancel-rule-edit").hidden = true;
  renderRulePickers();
}

function render() {
  if (!state.catalog) return;
  const canTest = state.capabilities?.test_notification !== false;
  const platformLabels = Object.fromEntries(state.catalog.platforms.map((item) => [item.code, item.label]));
  const tagLabels = Object.fromEntries(state.catalog.primary_tags.map((item) => [item.code, item.label]));
  const recipientLabels = Object.fromEntries(state.recipients.map((item) => [item.id, item.display_name]));
  const selectedRecipient = $("#rule-recipient").value;
  $("#rule-recipient").innerHTML = state.recipients.filter((recipient) => recipient.enabled).map((recipient) => `<option value="${esc(recipient.id)}">${esc(recipient.display_name)}</option>`).join("");
  if (selectedRecipient && [...$("#rule-recipient").options].some((option) => option.value === selectedRecipient)) $("#rule-recipient").value = selectedRecipient;
  renderRulePickers();
  $("#recipient-list").innerHTML = table(["显示名", "userId", "来源", "状态", "操作"], state.recipients.map((recipient) => `<tr><td>${esc(recipient.display_name)}</td><td>${esc(recipient.dingtalk_user_id)}</td><td>${esc(recipient.source)}</td><td><span class="badge ${recipient.enabled ? "" : "off"}">${recipient.enabled ? "启用" : "停用"}</span></td><td><button class="mini edit-recipient" data-id="${esc(recipient.id)}">编辑</button><button class="mini toggle-recipient" data-id="${esc(recipient.id)}" data-enabled="${!recipient.enabled}">${recipient.enabled ? "停用" : "启用"}</button></td></tr>`));
  $("#rule-list").innerHTML = table(["收件人", "平台范围", "主标签范围", "状态", "操作"], state.rules.map((rule) => `<tr><td>${esc(recipientLabels[rule.recipient_id] || "未知收件人")}</td><td>${scopeLabels(ruleScopes(rule, "platform_codes", "platform_code"), platformLabels, "全部平台")}</td><td>${scopeLabels(ruleScopes(rule, "primary_tag_codes", "primary_tag_code"), tagLabels, "全部主标签")}</td><td><span class="badge ${rule.enabled ? "" : "off"}">${rule.enabled ? "启用" : "停用"}</span></td><td><button class="mini edit-rule" data-id="${esc(rule.id)}">编辑</button><button class="mini toggle-rule" data-id="${esc(rule.id)}" data-enabled="${!rule.enabled}">${rule.enabled ? "停用" : "启用"}</button></td></tr>`));
  $("#match-preview").innerHTML = state.recipients.map((recipient) => {
    const rules = state.rules.filter((rule) => rule.recipient_id === recipient.id && rule.enabled);
    const descriptions = rules.map((rule) => `${scopeSelectionText(ruleScopes(rule, "platform_codes", "platform_code"), platformLabels, "全部平台")} × ${scopeSelectionText(ruleScopes(rule, "primary_tag_codes", "primary_tag_code"), tagLabels, "全部主标签")}`);
    return `<article class="preview-card"><h3>${esc(recipient.display_name)}</h3><p>${recipient.enabled ? "已启用" : "已停用"} · ${rules.length} 条有效规则</p><ul>${descriptions.map((description) => `<li>${esc(description)}</li>`).join("") || "<li>当前不会收到业务通知</li>"}</ul>${canTest ? `<button class="mini test-notification" data-id="${esc(recipient.id)}">发送测试通知</button>` : '<p class="hint">本机配置页不发送测试通知</p>'}</article>`;
  }).join("") || "暂无收件人";
  $("#dispatch-list").innerHTML = `<h3>发送记录</h3>${table(["日期", "收件人", "事件数", "状态", "task_id", "失败分类"], state.dispatches.map((item) => `<tr><td>${esc(item.report_date)}</td><td>${esc(item.display_name)}</td><td>${esc(item.event_count)}</td><td>${esc(item.status)}</td><td>${esc(item.task_id || "")}</td><td>${esc(item.failure_type || "")}</td></tr>`))}`;
  $("#audit-list").innerHTML = `<h3>操作记录</h3>${table(["时间", "操作", "对象", "详情"], state.audits.map((item) => `<tr><td>${esc(item.created_at)}</td><td>${esc(item.action)}</td><td>${esc(item.target_type)}</td><td>${esc(JSON.stringify(item.detail_json || {}))}</td></tr>`))}`;
  bindRowActions();
  $("#seed-test-subscription").hidden = state.capabilities?.seed_test_subscription === false;
  $("#directory-form").hidden = state.capabilities?.directory_search === false;
}

async function refresh() { apply(await api("session")); }

function bindRowActions() {
  document.querySelectorAll(".edit-recipient").forEach((button) => {
    button.onclick = () => {
      const recipient = state.recipients.find((item) => item.id === button.dataset.id);
      if (!recipient) return;
      $("#recipient-id").value = recipient.id;
      $("#recipient-name").value = recipient.display_name;
      $("#recipient-userid").value = recipient.dingtalk_user_id;
      $("#recipient-source").value = recipient.source;
      $("#recipient-enabled").checked = recipient.enabled;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
  document.querySelectorAll(".toggle-recipient").forEach((button) => { button.onclick = async () => apply(await api("toggle_recipient", { method: "POST", body: JSON.stringify({ id: button.dataset.id, enabled: button.dataset.enabled === "true" }) })); });
  document.querySelectorAll(".edit-rule").forEach((button) => {
    button.onclick = () => {
      const rule = state.rules.find((item) => item.id === button.dataset.id);
      if (!rule) return;
      $("#rule-id").value = rule.id;
      $("#rule-recipient").value = rule.recipient_id;
      $("#rule-enabled").checked = rule.enabled;
      draft.platform_codes = ruleScopes(rule, "platform_codes", "platform_code");
      draft.primary_tag_codes = ruleScopes(rule, "primary_tag_codes", "primary_tag_code");
      $("#cancel-rule-edit").hidden = false;
      renderRulePickers();
      $("#rule-form").scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });
  document.querySelectorAll(".toggle-rule").forEach((button) => { button.onclick = async () => apply(await api("toggle_rule", { method: "POST", body: JSON.stringify({ id: button.dataset.id, enabled: button.dataset.enabled === "true" }) })); });
  document.querySelectorAll(".test-notification").forEach((button) => {
    button.onclick = async () => {
      if (!confirm("将向环境变量指定的测试 userId 真实发送一条三平台聚合测试通知，是否继续？")) return;
      const result = await api("test_notification", { method: "POST", body: JSON.stringify({ recipient_id: button.dataset.id }) });
      toast(`测试通知状态：${result.status}，task_id：${result.task_id || "未返回"}`);
      await refresh();
    };
  });
}

$("#login-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api("login", { method: "POST", body: JSON.stringify({ password: $("#admin-password").value }) }); state.csrf = result.csrf_token; $("#login-panel").hidden = true; $("#app").hidden = false; await refresh(); } catch (error) { toast(error.message); } };
$("#logout").onclick = async () => { await api("logout", { method: "POST", body: "{}" }); location.reload(); };
$("#seed-test-subscription").onclick = async () => { if (!confirm("将创建或启用测试收件人，并订阅全部平台和全部主标签。正式发送仍受服务端发送门禁控制，是否继续？")) return; try { apply(await api("seed_test_subscription", { method: "POST", body: "{}" })); toast("测试收件人和全量订阅规则已初始化"); } catch (error) { toast(error.message); } };
$("#directory-form").onsubmit = async (event) => { event.preventDefault(); try { const result = await api(`directory&q=${encodeURIComponent($("#directory-query").value)}`); $("#directory-results").innerHTML = result.people.map((person) => `<button type="button" data-name="${esc(person.display_name)}" data-userid="${esc(person.dingtalk_user_id)}">${esc(person.display_name)} · ${esc(person.dingtalk_user_id)}</button>`).join("") || "未找到，可手工填写"; $("#directory-results").querySelectorAll("button").forEach((button) => { button.onclick = () => { $("#recipient-name").value = button.dataset.name; $("#recipient-userid").value = button.dataset.userid; $("#recipient-source").value = "directory"; }; }); } catch (error) { toast(`${error.message}；可改为手工填写 userId`); } };
$("#recipient-form").onsubmit = async (event) => { event.preventDefault(); try { apply(await api("save_recipient", { method: "POST", body: JSON.stringify({ id: $("#recipient-id").value, display_name: $("#recipient-name").value, dingtalk_user_id: $("#recipient-userid").value, source: $("#recipient-source").value, enabled: $("#recipient-enabled").checked }) })); event.target.reset(); $("#recipient-enabled").checked = true; $("#recipient-source").value = "manual"; toast("收件人已保存"); } catch (error) { toast(error.message); } };
$("#rule-form").onsubmit = async (event) => { event.preventDefault(); try { apply(await api("save_rule", { method: "POST", body: JSON.stringify({ id: $("#rule-id").value, recipient_id: $("#rule-recipient").value, platform_codes: draft.platform_codes, primary_tag_codes: draft.primary_tag_codes, enabled: $("#rule-enabled").checked }) })); resetRuleForm(); toast("订阅规则已保存"); } catch (error) { toast(error.message); } };
$("#cancel-rule-edit").onclick = resetRuleForm;
document.querySelectorAll(".tab").forEach((tab) => { tab.onclick = () => { document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab)); document.querySelectorAll(".tab-panel").forEach((item) => { item.hidden = item.id !== tab.dataset.target; }); }; });
document.addEventListener("click", (event) => { if (event.target.closest(".scope-picker")) return; document.querySelectorAll(".scope-picker-menu").forEach((menu) => { menu.hidden = true; }); document.querySelectorAll(".scope-picker-trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false")); });

try { const result = await api("session"); $("#login-panel").hidden = true; $("#app").hidden = false; apply(result); } catch { /* Unauthenticated is the normal first visit. */ }
