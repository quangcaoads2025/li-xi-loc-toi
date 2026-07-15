(function () {
  "use strict";

  var C = window.NA_CONFIG;
  if (!C) {
    console.error("Thiếu file js/config.js");
    return;
  }

  var state = {
    customer: null,
    voucherCode: "",
    prizeName: "",
    prizeImage: C.DEFAULT_PRIZE_IMAGE,
    isAllocating: false,
    selectedBag: null
  };

  var dom = {};
  var toastTimer = null;

  function byId(id) { return document.getElementById(id); }
  function qsa(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function cacheDom() {
    [
      "loginView", "appView", "loginForm", "loginUser", "loginPass", "rememberMe", "loginError", "btnLogin",
      "passwordToggle", "logoutBtn", "registerForm", "storeSelect", "stageForm", "stageBags", "stageFinal",
      "customerSummary", "bagsGrid", "bagLoadingNote", "editInfoBtn", "resultModal", "resultCloseBtn",
      "resultPrizeImage", "resultPrizeName", "resultVoucherCode", "claimPrizeBtn", "finalCustomerName",
      "finalPrizeImage", "finalPrizeName", "finalVoucherCode", "finalMeta", "copyVoucherBtn", "nextCustomerBtn",
      "alertModal", "alertMessage", "alertOkBtn", "confettiLayer", "toast"
    ].forEach(function (id) { dom[id] = byId(id); });
  }

  function init() {
    cacheDom();
    populateStores();
    bindEvents();

    if (isLoggedIn()) {
      showApplication();
    } else {
      showLogin();
    }
  }

  function populateStores() {
    C.STORES.forEach(function (store) {
      var option = document.createElement("option");
      option.value = store;
      option.textContent = store;
      dom.storeSelect.appendChild(option);
    });
  }

  function bindEvents() {
    dom.loginForm.addEventListener("submit", handleLogin);
    dom.passwordToggle.addEventListener("click", togglePassword);
    dom.logoutBtn.addEventListener("click", logout);
    dom.registerForm.addEventListener("submit", handleCustomerSubmit);
    dom.editInfoBtn.addEventListener("click", function () {
      if (!state.isAllocating) showStage(1);
    });

    qsa(".bag-card", dom.bagsGrid).forEach(function (button) {
      button.addEventListener("click", function () { handleBagSelection(button); });
    });

    dom.claimPrizeBtn.addEventListener("click", completePrizeFlow);
    dom.resultCloseBtn.addEventListener("click", completePrizeFlow);
    dom.nextCustomerBtn.addEventListener("click", resetForNextCustomer);
    dom.copyVoucherBtn.addEventListener("click", copyVoucher);
    dom.alertOkBtn.addEventListener("click", closeAlert);

    dom.alertModal.addEventListener("click", function (event) {
      if (event.target === dom.alertModal) closeAlert();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (!dom.alertModal.hidden) closeAlert();
        else if (!dom.resultModal.hidden) completePrizeFlow();
      }
    });
  }

  function isLoggedIn() {
    return localStorage.getItem(C.LOGIN_LOCAL_KEY) === "true" || sessionStorage.getItem(C.LOGIN_SESSION_KEY) === "true";
  }

  function showLogin() {
    dom.loginView.hidden = false;
    dom.appView.hidden = true;
    document.body.classList.remove("app-open");
    setTimeout(function () { dom.loginUser.focus(); }, 80);
  }

  function showApplication() {
    dom.loginView.hidden = true;
    dom.appView.hidden = false;
    document.body.classList.add("app-open");
    showStage(1, false);
  }

  function togglePassword() {
    var showing = dom.loginPass.type === "text";
    dom.loginPass.type = showing ? "password" : "text";
    dom.passwordToggle.setAttribute("aria-label", showing ? "Hiện mật khẩu" : "Ẩn mật khẩu");
  }

  function setLoginLoading(loading) {
    dom.btnLogin.disabled = loading;
    dom.btnLogin.classList.toggle("is-loading", loading);
    var label = dom.btnLogin.querySelector(".btn-label");
    if (label) label.textContent = loading ? "Đang kiểm tra..." : "Đăng nhập";
  }

  function showLoginError(message) {
    dom.loginError.textContent = message;
    dom.loginError.classList.add("is-visible");
  }

  function clearLoginError() {
    dom.loginError.textContent = "";
    dom.loginError.classList.remove("is-visible");
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearLoginError();

    var username = dom.loginUser.value.trim();
    var password = dom.loginPass.value.trim();
    if (!username || !password) {
      showLoginError("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.");
      (!username ? dom.loginUser : dom.loginPass).focus();
      return;
    }

    setLoginLoading(true);
    try {
      var response = await jsonpRequest(C.API_URL, {
        action: "checkLogin",
        u: username,
        p: password
      });

      if (!response || response.success !== true) {
        throw new Error((response && response.message) || "Tên đăng nhập hoặc mật khẩu không đúng.");
      }

      if (dom.rememberMe.checked) {
        localStorage.setItem(C.LOGIN_LOCAL_KEY, "true");
        sessionStorage.removeItem(C.LOGIN_SESSION_KEY);
      } else {
        sessionStorage.setItem(C.LOGIN_SESSION_KEY, "true");
        localStorage.removeItem(C.LOGIN_LOCAL_KEY);
      }

      dom.loginPass.value = "";
      showApplication();
      showToast("Đăng nhập thành công.");
    } catch (error) {
      showLoginError(humanizeError(error, "Không thể đăng nhập. Vui lòng kiểm tra kết nối và thử lại."));
    } finally {
      setLoginLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(C.LOGIN_LOCAL_KEY);
    sessionStorage.removeItem(C.LOGIN_SESSION_KEY);
    resetForNextCustomer(false);
    dom.loginForm.reset();
    showLogin();
  }

  function normalizePhone(value) {
    var digits = String(value || "").replace(/\D/g, "");
    return digits.length === 9 ? "0" + digits : digits;
  }

  function isValidPhone(phone) {
    return /^0\d{9}$/.test(phone);
  }

  function handleCustomerSubmit(event) {
    event.preventDefault();

    if (!dom.registerForm.reportValidity()) return;

    var data = new FormData(dom.registerForm);
    var phone = normalizePhone(data.get("phone"));
    if (!isValidPhone(phone)) {
      showAlert("Số điện thoại không hợp lệ.\nVui lòng nhập đúng 10 số và bắt đầu bằng số 0.");
      dom.registerForm.elements.phone.focus();
      return;
    }

    if (localStorage.getItem(C.SPUN_PHONE_PREFIX + phone) === "true") {
      showAlert("Số điện thoại " + phone + " đã tham gia chương trình trên thiết bị này.");
      return;
    }

    state.customer = {
      name: String(data.get("name") || "").trim(),
      phone: phone,
      address: String(data.get("address") || "").trim(),
      car: String(data.get("car") || "").trim(),
      store: String(data.get("note") || "").trim()
    };
    state.voucherCode = generateVoucherCode();
    state.prizeName = "";
    state.prizeImage = C.DEFAULT_PRIZE_IMAGE;

    renderCustomerSummary();
    showStage(2);
  }

  function renderCustomerSummary() {
    var c = state.customer;
    dom.customerSummary.innerHTML = "";
    [
      ["Khách hàng", c.name],
      ["Điện thoại", c.phone],
      ["Dòng xe", c.car],
      ["Cửa hàng", c.store]
    ].forEach(function (item) {
      var span = document.createElement("span");
      span.className = "summary-item";
      span.innerHTML = escapeHtml(item[0]) + ": <b>" + escapeHtml(item[1]) + "</b>";
      dom.customerSummary.appendChild(span);
    });
  }

  async function handleBagSelection(button) {
    if (state.isAllocating || !state.customer) return;

    state.isAllocating = true;
    state.selectedBag = button;
    setBagsBusy(button, true);

    try {
      var results = await Promise.all([
        allocatePrize(),
        delay(C.MIN_REVEAL_DELAY_MS)
      ]);
      var response = results[0];

      if (!response || response.success !== true) {
        throw new Error((response && response.message) || "Không thể cấp quà từ hệ thống.");
      }

      state.prizeName = String(response.prize_name || "Quà tặng từ Xe Ngọc Anh").trim();
      state.prizeImage = resolvePrizeImage(state.prizeName);
      localStorage.setItem(C.SPUN_PHONE_PREFIX + state.customer.phone, "true");

      renderResultModal();
      openResultModal();
    } catch (error) {
      setBagsBusy(button, false);
      showAlert(humanizeError(error, "Không thể kết nối kho quà. Vui lòng thử lại."));
    } finally {
      state.isAllocating = false;
    }
  }

  function allocatePrize() {
    var c = state.customer;
    return jsonpRequest(C.API_URL, {
      action: "alloc",
      phone: c.phone,
      name: c.name,
      address: c.address,
      car: c.car,
      note: c.store,
      coupon: state.voucherCode
    }, C.API_TIMEOUT_MS);
  }

  function setBagsBusy(selected, busy) {
    qsa(".bag-card", dom.bagsGrid).forEach(function (button) {
      button.disabled = busy;
      button.classList.toggle("is-selected", busy && button === selected);
    });
    dom.bagLoadingNote.hidden = !busy;
    dom.editInfoBtn.disabled = busy;
  }

  function resetBagButtons() {
    qsa(".bag-card", dom.bagsGrid).forEach(function (button) {
      button.disabled = false;
      button.classList.remove("is-selected");
    });
    dom.bagLoadingNote.hidden = true;
    dom.editInfoBtn.disabled = false;
  }

  function renderResultModal() {
    dom.resultPrizeImage.src = state.prizeImage;
    dom.resultPrizeImage.alt = state.prizeName;
    dom.resultPrizeName.textContent = state.prizeName;
    dom.resultVoucherCode.textContent = state.voucherCode;
  }

  function openResultModal() {
    dom.resultModal.hidden = false;
    document.body.style.overflow = "hidden";
    createConfetti();
    setTimeout(function () { dom.claimPrizeBtn.focus(); }, 120);
  }

  function closeResultModal() {
    dom.resultModal.hidden = true;
    document.body.style.overflow = "";
  }

  function completePrizeFlow() {
    if (!state.prizeName) return;
    closeResultModal();
    renderFinalStage();
    showStage(3);
  }

  function renderFinalStage() {
    var c = state.customer;
    dom.finalCustomerName.textContent = c.name;
    dom.finalPrizeImage.src = state.prizeImage;
    dom.finalPrizeImage.alt = state.prizeName;
    dom.finalPrizeName.textContent = state.prizeName;
    dom.finalVoucherCode.textContent = state.voucherCode;
    dom.finalMeta.innerHTML = "";
    ["SĐT: " + c.phone, "Xe: " + c.car, "Cửa hàng: " + c.store].forEach(function (text) {
      var chip = document.createElement("span");
      chip.textContent = text;
      dom.finalMeta.appendChild(chip);
    });
  }

  function showStage(step, scroll) {
    dom.stageForm.hidden = step !== 1;
    dom.stageBags.hidden = step !== 2;
    dom.stageFinal.hidden = step !== 3;
    updateStepper(step);

    if (scroll !== false) {
      var target = step === 1 ? dom.stageForm : step === 2 ? dom.stageBags : dom.stageFinal;
      setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 40);
    }
  }

  function updateStepper(currentStep) {
    qsa(".step").forEach(function (step) {
      var value = Number(step.getAttribute("data-step"));
      step.classList.toggle("is-active", value === currentStep);
      step.classList.toggle("is-complete", value < currentStep);
      var circle = step.querySelector("span");
      circle.textContent = value < currentStep ? "✓" : String(value);
    });
  }

  function resetForNextCustomer(scroll) {
    closeResultModal();
    dom.registerForm.reset();
    state.customer = null;
    state.voucherCode = "";
    state.prizeName = "";
    state.prizeImage = C.DEFAULT_PRIZE_IMAGE;
    state.isAllocating = false;
    state.selectedBag = null;
    resetBagButtons();
    showStage(1, scroll !== false);
    if (scroll !== false) setTimeout(function () { dom.registerForm.elements.name.focus(); }, 250);
  }

  async function copyVoucher() {
    var code = state.voucherCode || dom.finalVoucherCode.textContent;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        var textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      showToast("Đã sao chép mã " + code);
    } catch (error) {
      showToast("Không thể sao chép tự động. Mã quà: " + code);
    }
  }

  function generateVoucherCode() {
    var value;
    if (window.crypto && window.crypto.getRandomValues) {
      var array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      value = array[0] % 1000000;
    } else {
      value = Math.floor(Math.random() * 1000000);
    }
    return "NA" + String(value).padStart(6, "0");
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function resolvePrizeImage(prizeName) {
    var normalized = normalizeText(prizeName);
    for (var i = 0; i < C.PRIZE_ASSETS.length; i += 1) {
      var match = C.PRIZE_ASSETS[i].keywords.some(function (keyword) {
        return normalized.indexOf(keyword) !== -1;
      });
      if (match) return C.PRIZE_ASSETS[i].image;
    }
    return C.DEFAULT_PRIZE_IMAGE;
  }

  function jsonpRequest(url, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var callbackName = "na_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
      var script = document.createElement("script");
      var finished = false;
      var timer;
      var payload = Object.assign({}, params, { callback: callbackName, _t: Date.now() });
      var query = Object.keys(payload).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(String(payload[key]));
      }).join("&");

      function cleanup() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (error) { window[callbackName] = undefined; }
      }

      window[callbackName] = function (data) {
        cleanup();
        resolve(data);
      };

      script.async = true;
      script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + query;
      script.onerror = function () {
        cleanup();
        reject(new Error("Không thể kết nối Google Apps Script. Hãy kiểm tra mạng hoặc quyền triển khai Web App."));
      };

      timer = setTimeout(function () {
        cleanup();
        reject(new Error("Kết nối quá thời gian. Vui lòng thử lại."));
      }, timeoutMs || C.API_TIMEOUT_MS);

      document.body.appendChild(script);
    });
  }

  function humanizeError(error, fallback) {
    if (!error) return fallback;
    var message = String(error.message || error).trim();
    return message || fallback;
  }

  function showAlert(message) {
    dom.alertMessage.textContent = message;
    dom.alertModal.hidden = false;
    setTimeout(function () { dom.alertOkBtn.focus(); }, 80);
  }

  function closeAlert() {
    dom.alertModal.hidden = true;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    toastTimer = setTimeout(function () { dom.toast.classList.remove("is-visible"); }, 2600);
  }

  function createConfetti() {
    dom.confettiLayer.innerHTML = "";
    var colors = ["#ffd66f", "#ffffff", "#ff6b82", "#60d6ff", "#8bf0ad"];
    for (var i = 0; i < 70; i += 1) {
      var piece = document.createElement("i");
      piece.className = "confetti-piece";
      piece.style.setProperty("--x", Math.random() * 100 + "%");
      piece.style.setProperty("--w", 5 + Math.random() * 7 + "px");
      piece.style.setProperty("--h", 7 + Math.random() * 12 + "px");
      piece.style.setProperty("--c", colors[Math.floor(Math.random() * colors.length)]);
      piece.style.setProperty("--d", 1.8 + Math.random() * 1.7 + "s");
      piece.style.setProperty("--delay", Math.random() * .5 + "s");
      piece.style.setProperty("--drift", (-100 + Math.random() * 200) + "px");
      piece.style.setProperty("--r", Math.random() * 360 + "deg");
      dom.confettiLayer.appendChild(piece);
    }
    setTimeout(function () { dom.confettiLayer.innerHTML = ""; }, 3800);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
