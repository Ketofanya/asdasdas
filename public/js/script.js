let currentUser = null;
let isEditingUser = false;
let currentEditUsername = null;
let socket = io();
let userSessions = {};
let isEditingAppointment = false;
let currentEditAppointmentId = null;
let viewMode = 'card'; // 'card' | 'simple'

const loginOverlay = document.getElementById("loginOverlay");
const mainContent = document.getElementById("mainContent");
const themeToggle = document.getElementById("themeToggle");
const appointmentsTableBody = document.getElementById("appointmentsTableBody");

document.addEventListener("DOMContentLoaded", function () {
  // التحقق من الجلسة الحالية
  checkSession();

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    enableLightTheme();
  }

  setupEventListeners();

  setupSocketListeners();
  
  // التحقق من الجلسة كل 5 دقائق
  setInterval(checkSession, 5 * 60 * 1000);
});

function setupEventListeners() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);

  document
    .getElementById("appointmentForm")
    .addEventListener("submit", handleAddAppointment);

  document
    .getElementById("searchForm")
    .addEventListener("submit", handleSearch);

  document
    .getElementById("departmentForm")
    .addEventListener("submit", handleAddDepartment);

  document.getElementById("userForm").addEventListener("submit", handleAddUser);

  document.querySelectorAll(".search-option").forEach((option) => {
    option.addEventListener("click", function () {
      setSearchOption(this.dataset.option);
    });
  });

  themeToggle.addEventListener("click", toggleTheme);

  const mobileMenuBtn = document.querySelector(".mobile-menu-btn");
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // toggleMobileMenu();
    });
  }

  // دعم فتح القوائم المنسدلة باللمس في الموبايل
  const dropdownTriggers = document.querySelectorAll(".dropdown > a");
  dropdownTriggers.forEach((trigger) => {
    trigger.addEventListener("click", function (e) {
      if (window.innerWidth <= 768) {
        e.preventDefault();
        const parent = this.parentElement;
        const isActive = parent.classList.contains("active");
        document.querySelectorAll(".dropdown").forEach((d) => d.classList.remove("active"));
        if (!isActive) parent.classList.add("active");
      }
    });
  });

  // إغلاق القائمة عند الضغط خارجها في الموبايل
  document.addEventListener("click", function (e) {
    const navRight = document.getElementById("navRight");
    const isClickInside = navRight && navRight.contains(e.target);
    const isMenuBtn = e.target.closest && e.target.closest(".mobile-menu-btn");
    if (window.innerWidth <= 768 && !isClickInside && !isMenuBtn) {
      navRight && navRight.classList.remove("active");
      document.querySelectorAll(".dropdown").forEach((d) => d.classList.remove("active"));
      document.body.classList.remove("no-scroll");
    }
  });

  // إعادة تعيين الحالة عند تغيير حجم النافذة
  window.addEventListener("resize", function () {
    const navRight = document.getElementById("navRight");
    if (window.innerWidth > 768) {
      navRight && navRight.classList.remove("active");
      document.querySelectorAll(".dropdown").forEach((d) => d.classList.remove("active"));
      document.body.classList.remove("no-scroll");
    }
  });

  // document.querySelectorAll('.report-tab').forEach(tab => {
  //   tab.addEventListener('click', function() {
  //     document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
  //     this.classList.add('active');
  //     showReportSection(this.dataset.section);
  //   });
  // });

  // document.getElementById("generateDailyReportBtn").addEventListener("click", generateDailyReport);
  // document.getElementById("generateComprehensiveReportBtn").addEventListener("click", generateComprehensiveReport);
  // document.getElementById("generateInteractionReportBtn").addEventListener("click", generateInteractionReport);
  // document.getElementById("downloadBackupBtn").addEventListener("click", downloadBackup);
}

function setupSocketListeners() {
  socket.on("appointmentUpdated", (appointments) => {
    updateAppointmentsView(appointments);
  });

  socket.on("departmentsUpdated", (departments) => {
    updateDepartmentsList(departments);
    updateDepartmentDropdowns(departments); 
  });

  socket.on("usersUpdated", (users) => {
    updateUsersList(users);
  });

  socket.on("permissionsUpdated", (data) => {
    // تحديث الصلاحيات للمستخدم الحالي إذا كان هو المستهدف
    if (currentUser && currentUser.username === data.username) {
      currentUser.permissions = data.permissions;
      // تحديث الواجهة فوراً
      updateUIForUser();
    }
  });
}

// التحقق من الجلسة الحالية
async function checkSession() {
  try {
    const response = await fetch("/api/session", {
      method: "GET",
      credentials: 'include' // مهم لإرسال الكوكيز
    });
    const result = await response.json();
    
    if (result.success && result.user) {
      // إذا كان المستخدم مختلف عن الحالي، حدث الواجهة
      if (!currentUser || currentUser.username !== result.user.username) {
        currentUser = result.user;
        showMainContent();
        updateUIForUser();
        loadAppointments();
      }
    } else {
      // إذا كان المستخدم مسجل دخول سابقاً ولكن الجلسة انتهت
      if (currentUser) {
        currentUser = null;
        showLogin();
        hideProtectedElements();
      }
    }
  } catch (error) {
    console.error("Session check error:", error);
    if (currentUser) {
      currentUser = null;
      showLogin();
      hideProtectedElements();
    }
  }
}

// تحديث الواجهة بناءً على المستخدم الحالي
function updateUIForUser() {
  if (!currentUser) return;
  
  // إنشاء أو تحديث معلومات المستخدم في الواجهة
  let userInfoElement = document.querySelector('.user-info');
  if (!userInfoElement) {
    // إنشاء عنصر معلومات المستخدم إذا لم يكن موجوداً
    userInfoElement = document.createElement('div');
    userInfoElement.className = 'user-info';
    userInfoElement.innerHTML = `
      <span class="user-name">${currentUser.username}</span>
      <span class="user-role">(${currentUser.role === 'admin' ? 'مدير' : 'موظف'})</span>
      <button class="logout-btn" onclick="logout()">تسجيل الخروج</button>
    `;
    
    // إضافة العنصر إلى شريط التنقل
    const navRight = document.getElementById('navRight');
    if (navRight) {
      navRight.insertBefore(userInfoElement, navRight.querySelector('.theme-toggle'));
    }
  } else {
    // تحديث المعلومات الموجودة
    const userNameElement = userInfoElement.querySelector('.user-name');
    const userRoleElement = userInfoElement.querySelector('.user-role');
    
    if (userNameElement) userNameElement.textContent = currentUser.username;
    if (userRoleElement) userRoleElement.textContent = `(${currentUser.role === 'admin' ? 'مدير' : 'موظف'})`;
  }
  
  // إظهار معلومات المستخدم
  userInfoElement.style.display = 'flex';
  
  // إخفاء/إظهار العناصر حسب الصلاحيات
  updatePermissionsUI();
  
  // تحديث واجهة إضافة المواعيد لتظهر الصلاحيات المحدثة
  updateAppointmentModalPermissions();
}

// تحديث واجهة الصلاحيات
function updatePermissionsUI() {
  if (!currentUser) return;
  
  const isAdmin = currentUser.role === 'admin';
  const isStaffOrAdmin = currentUser.role === 'admin' || currentUser.role === 'staff';
  
  // تحديث قائمة المواعيد
  const appointmentLinks = document.querySelectorAll('.dropdown-content a');
  appointmentLinks.forEach(link => {
    const text = link.textContent.trim();
    if (text === 'إضافة موعد' || text === 'بحث عن موعد') {
      link.style.display = isStaffOrAdmin ? 'block' : 'none';
    } else if (text === 'حذف جميع المواعيد') {
      link.style.display = isAdmin ? 'block' : 'none';
    }
  });
  
  // تحديث رابط التقارير
  const reportsLink = document.querySelector('a[onclick="openReportsModal()"]');
  if (reportsLink) {
    reportsLink.style.display = isStaffOrAdmin ? 'block' : 'none';
  }
  
  // تحديث قائمة الإدارة
  const managementDropdown = document.querySelector('.dropdown a[href="#management"]');
  if (managementDropdown) {
    managementDropdown.parentElement.style.display = isAdmin ? 'block' : 'none';
  }
  
  // تحديث زر الإضافة العائم
  const fabButton = document.querySelector('.fab');
  if (fabButton) {
    fabButton.style.display = isStaffOrAdmin ? 'block' : 'none';
  }
  
  // إظهار جميع العناصر المحمية
  const protectedElements = document.querySelectorAll('.dropdown-content, .dropdown');
  protectedElements.forEach(element => {
    element.style.display = 'block';
  });
}

// تحديث صلاحيات نافذة إضافة المواعيد
function updateAppointmentModalPermissions() {
  if (!currentUser) return;
  
  const historicalControls = document.getElementById("historicalControls");
  if (historicalControls) {
    const isAllowedHistorical = currentUser.role === 'admin' || 
      (currentUser.permissions && currentUser.permissions.canAddHistorical === true);
    
    historicalControls.classList.toggle('hidden', !isAllowedHistorical);
    
    const isHistorical = document.getElementById('isHistorical');
    const serialNumber = document.getElementById('serialNumber');
    
    if (isHistorical && serialNumber) {
      isHistorical.checked = false;
      serialNumber.disabled = true;
      serialNumber.value = '';
      
      isHistorical.onchange = function() {
        serialNumber.disabled = !isHistorical.checked;
      };
    }
  }
}

// تسجيل الخروج
async function logout() {
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: 'include', // مهم لإرسال الكوكيز
    });

    const result = await response.json();

    if (result.success) {
      currentUser = null;
      showLogin();
      // إخفاء جميع العناصر المحمية
      hideProtectedElements();
      // إعادة تحميل الصفحة للتأكد من تحديث جميع العناصر
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } else {
      alert(result.message || "Failed to logout");
    }
  } catch (error) {
    console.error("Logout error:", error);
    alert("An error occurred during logout");
  }
}

// إخفاء العناصر المحمية عند تسجيل الخروج
function hideProtectedElements() {
  // إخفاء جميع الأزرار والروابط المحمية
  const protectedElements = document.querySelectorAll('.dropdown-content a, .fab, a[onclick="openReportsModal()"], .dropdown a[href="#management"]');
  protectedElements.forEach(element => {
    element.style.display = 'none';
  });
  
  // إخفاء معلومات المستخدم
  const userInfo = document.querySelector('.user-info');
  if (userInfo) {
    userInfo.style.display = 'none';
  }
}

function showLogin() {
  loginOverlay.style.display = "flex";
  mainContent.classList.remove("active");
}

function closeLogin() {
  loginOverlay.style.display = "none";
}

function showMainContent() {
  loginOverlay.style.display = "none";
  mainContent.classList.add("active");
  loadAppointments();
}

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: 'include', // مهم لإرسال الكوكيز
      body: JSON.stringify({ username, password }),
    });

    const result = await response.json();

    if (result.success) {
      currentUser = result.user;
      showMainContent();
      // تحديث الواجهة فوراً بعد تسجيل الدخول
      updateUIForUser();
      // إعادة تحميل المواعيد
      loadAppointments();
      // إعادة تحميل الصفحة للتأكد من تحديث جميع العناصر
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } else {
      alert(result.message || "Login failed");
    }
  } catch (error) {
    console.error("Login error:", error);
    alert("An error occurred during login");
  }
}

function openAppointmentModal() {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().slice(0, 5);

  document.getElementById("patientName").value = "";
  document.getElementById("patientId").value = "";
  document.getElementById("patientPhone").value = "";
  document.getElementById("patientBirthDate").value = "";
  document.getElementById("appointmentDate").value = dateStr;
  document.getElementById("appointmentTime").value = timeStr;
  document.getElementById("department").value = "";

  // تحديث صلاحيات المواعيد القديمة
  updateAppointmentModalPermissions();

  document.querySelector("#appointmentModal h2").textContent = "إضافة موعد جديد";
  document.querySelector('#appointmentForm button[type="submit"]').textContent = "حفظ الموعد";

  isEditingAppointment = false;
  currentEditAppointmentId = null;

  document.getElementById("appointmentModal").classList.add("active");
}

function closeAppointmentModal() {
  document.getElementById("appointmentModal").classList.remove("active");
  document.getElementById("appointmentForm").reset();
  isEditingAppointment = false;
  currentEditAppointmentId = null;

  document.querySelector("#appointmentModal h2").textContent =
    "إضافة موعد جديد";
  document.querySelector('#appointmentForm button[type="submit"]').textContent =
    "حفظ الموعد";
}

function openEditAppointmentModal(appointment) {
  isEditingAppointment = true;
  currentEditAppointmentId = appointment.id;

  document.getElementById("patientName").value = appointment.patientName;
  document.getElementById("patientId").value = appointment.patientId;
  document.getElementById("patientPhone").value = appointment.patientPhone;
  document.getElementById("patientBirthDate").value =
    appointment.patientBirthDate || "";
  document.getElementById("appointmentDate").value =
    appointment.appointmentDate;
  document.getElementById("appointmentTime").value =
    appointment.appointmentTime;
  document.getElementById("department").value = appointment.department;

  document.querySelector("#appointmentModal h2").textContent = "تعديل الموعد";
  document.querySelector('#appointmentForm button[type="submit"]').textContent =
    "تحديث الموعد";

  document.getElementById("appointmentModal").classList.add("active");
}

function closeEditAppointmentModal() {
  isEditingAppointment = false;
  currentEditAppointmentId = null;

  document.querySelector("#appointmentModal h2").textContent =
    "إضافة موعد جديد";
  document.querySelector('#appointmentForm button[type="submit"]').textContent =
    "حفظ الموعد";

  closeAppointmentModal();
}

async function handleEditAppointment(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const appointmentData = {
    patientName: formData.get("patientName"),
    patientId: formData.get("patientId"),
    patientPhone: formData.get("patientPhone"),
    patientBirthDate: formData.get("patientBirthDate") || null,
    appointmentDate: formData.get("appointmentDate"),
    appointmentTime: formData.get("appointmentTime"),
    department: formData.get("department"),
  };

  try {
    const response = await fetch(
      `/api/appointments/edit/${currentEditAppointmentId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(appointmentData),
      }
    );

    const result = await response.json();

    if (result.success) {
      closeEditAppointmentModal();
    } else {
      alert(result.message || "Failed to update appointment");
    }
  } catch (error) {
    console.error("Update appointment error:", error);
    alert("An error occurred while updating the appointment");
  }
}

async function handleAddAppointment(e) {
  e.preventDefault();

  if (isEditingAppointment) {
    await handleEditAppointment(e);
    return;
  }

  const formData = new FormData(e.target);
  const appointmentData = {
    patientName: formData.get("patientName"),
    patientId: formData.get("patientId"),
    patientPhone: formData.get("patientPhone"),
    patientBirthDate: formData.get("patientBirthDate") || null,
    appointmentDate: formData.get("appointmentDate"),
    appointmentTime: formData.get("appointmentTime"),
    department: formData.get("department"),
    isHistorical: document.getElementById('isHistorical') ? document.getElementById('isHistorical').checked : false,
    serialNumber: document.getElementById('serialNumber') ? Number(document.getElementById('serialNumber').value || undefined) : undefined,
  };

  // Client-side validation for ID/phone >= 10 digits
  const idDigits = String(appointmentData.patientId).replace(/\D/g, '');
  const phoneDigits = String(appointmentData.patientPhone).replace(/\D/g, '');
  if (idDigits.length < 10 || phoneDigits.length < 10) {
    alert('رقم الهوية ورقم الجوال يجب أن لا يقل عن 10 أرقام');
    return;
  }

  try {
    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: 'include',
      body: JSON.stringify(appointmentData),
    });

    if (response.status === 401) {
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لإضافة مواعيد");
      return;
    }

    const result = await response.json();

    if (result.success) {
      closeAppointmentModal();
    } else {
      alert(result.message || "Failed to add appointment");
    }
  } catch (error) {
    console.error("Add appointment error:", error);
    alert("An error occurred while adding the appointment");
  }
}

async function deleteAppointment(id) {
  if (!confirm("Are you sure you want to delete this appointment?")) return;

  try {
    const response = await fetch("/api/appointments", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: 'include',
      body: JSON.stringify({ id }),
    });

    if (response.status === 401) {
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لحذف المواعيد");
      return;
    }

    const result = await response.json();

    if (result.success) {
    } else {
      alert(result.message || "Failed to delete appointment");
    }
  } catch (error) {
    console.error("Delete appointment error:", error);
    alert("An error occurred while deleting the appointment");
  }
}

async function toggleAppointmentStatus(id) {
  try {
    const response = await fetch(`/api/appointments/toggle-status/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: 'include',
    });

    if (response.status === 401) {
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لتغيير حالة المواعيد");
      return;
    }

    const result = await response.json();

    if (!result.success) {
      alert(result.message || "Failed to toggle appointment status");
    }
  } catch (error) {
    console.error("Toggle status error:", error);
    alert("An error occurred while toggling the status");
  }
}

async function loadAppointments() {
  try {
    const response = await fetch("/api/appointments", {
      credentials: 'include'
    });
    
    if (response.status === 401) {
      // غير مصرح - إعادة توجيه لتسجيل الدخول
      currentUser = null;
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لعرض المواعيد");
      return;
    }
    
    const appointments = await response.json();
    updateAppointmentsView(appointments);
  } catch (error) {
    console.error("Load appointments error:", error);
  }
}

function updateAppointmentsTable(appointments) {
  if (appointments.length === 0) {
    appointmentsTableBody.innerHTML = `<div class="no-appointments">لا توجد مواعيد لعرضها.</div>`;
    return;
  }

  appointmentsTableBody.innerHTML = "";

  appointments.forEach((appointment, index) => {
    const card = document.createElement("div");
    card.className = "appointment-card";
    card.innerHTML = `
            <div class="appointment-card-header">
                <div class="appointment-number">#${appointment.serialNumber || (index + 1)}</div>
                <div class="appointment-status status-${appointment.status === 'منجز' ? 'done' : 'waiting'}">${appointment.status}</div>
            </div>
            <div class="appointment-card-body">
                <div class="appointment-info">
                    <span class="appointment-label">أسم المريض</span>
                    <span class="appointment-value">${
                      appointment.patientName
                    }</span>
                </div>
                <div class="appointment-info">
                    <span class="appointment-label">رقم الهوية</span>
                    <span class="appointment-value">${
                      appointment.patientId
                    }</span>
                </div>
                <div class="appointment-info">
                    <span class="appointment-label">الجوال</span>
                    <span class="appointment-value">${
                      appointment.patientPhone
                    }</span>
                </div>
                ${
                  appointment.patientBirthDate
                    ? `
                <div class="appointment-info">
                    <span class="appointment-label">تاريخ الميلاد</span>
                    <span class="appointment-value">${appointment.patientBirthDate}</span>
                </div>`
                    : ""
                }
                <div class="appointment-info">
                    <span class="appointment-label">القسم</span>
                    <span class="appointment-value">${
                      appointment.department
                    }</span>
                </div>
                <div class="appointment-info">
                    <span class="appointment-label">المعاد</span>
                    <span class="appointment-value">${
                      appointment.appointmentDate
                    }</span>
                </div>
                <div class="appointment-info">
                    <span class="appointment-label">الوقت</span>
                    <span class="appointment-value">${
                      appointment.appointmentTime
                    }</span>
                </div>
            </div>
            <div class="appointment-actions">
                ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') ? `
                <button class="action-btn delete-btn" onclick="deleteAppointment('${
                  appointment.id
                }')">حذف</button>
                <button class="action-btn edit-btn" onclick="openEditAppointmentModal(${JSON.stringify(
                  appointment
                ).replace(/"/g, "&quot;")})">تعديل</button>
                ` : ''}
                ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') ? `
                <button class="action-btn done-btn" onclick="toggleAppointmentStatus('${
                  appointment.id
                }')">
                  ${appointment.status === "انتظار" ? "منجز" : "انتظار"}
                </button>
                ` : ''}
            </div>
        `;

    appointmentsTableBody.appendChild(card);
  });
}

function updateAppointmentsSimple(appointments) {
  const body = document.getElementById('appointmentsSimpleBody');
  if (!body) return;
  if (!appointments || appointments.length === 0) {
    body.innerHTML = '<tr><td colspan="9">لا توجد مواعيد لعرضها.</td></tr>';
    return;
  }
  body.innerHTML = '';
  appointments.forEach((a, index) => {
    const tr = document.createElement('tr');
    const actions = (currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff')) ? `
      <button class="action-btn delete-btn" onclick="deleteAppointment('${a.id}')">حذف</button>
      <button class="action-btn edit-btn" onclick='openEditAppointmentModal(${JSON.stringify(a).replace(/"/g, "&quot;")})'>تعديل</button>
      <button class="action-btn done-btn" onclick="toggleAppointmentStatus('${a.id}')">${a.status === 'انتظار' ? 'منجز' : 'انتظار'}</button>
    ` : '';
    tr.innerHTML = `
      <td>${a.serialNumber || (index + 1)}</td>
      <td>${a.patientName}</td>
      <td>${a.patientId}</td>
      <td>${a.patientPhone}</td>
      <td>${a.department}</td>
      <td>${a.appointmentDate}</td>
      <td>${a.appointmentTime}</td>
      <td>${a.status}</td>
      ${actions ? `<td class="action-buttons">${actions}</td>` : ''}
    `;
    body.appendChild(tr);
  });
}

function updateAppointmentsView(appointments) {
  if (viewMode === 'card') {
    document.getElementById('appointmentsTableBody')?.parentElement?.style && (document.getElementById('appointmentsTableBody').parentElement.style.display = 'block');
    const simple = document.getElementById('appointmentsTableSimple');
    if (simple) simple.style.display = 'none';
    updateAppointmentsTable(appointments);
  } else {
    document.getElementById('appointmentsTableBody')?.parentElement?.style && (document.getElementById('appointmentsTableBody').parentElement.style.display = 'none');
    const simple = document.getElementById('appointmentsTableSimple');
    if (simple) simple.style.display = 'block';
    updateAppointmentsSimple(appointments);
  }
  updateTodaySummary(appointments);
  updateWaitingSummary(appointments);
}

function setViewMode(mode) {
  viewMode = mode === 'simple' ? 'simple' : 'card';
  // re-render using last known data by fetching current list
  loadAppointments();
}

function updateTodaySummary(appointments) {
  const today = new Date().toISOString().split("T")[0];
  const summaryBody = document.getElementById("todaySummaryBody");
  summaryBody.innerHTML = "";

  const deptCounts = {};
  appointments.forEach((apt) => {
    if (apt.appointmentDate === today && apt.status === "منجز") {
      if (!deptCounts[apt.department]) {
        deptCounts[apt.department] = 0;
      }
      deptCounts[apt.department]++;
    }
  });

  if (Object.keys(deptCounts).length === 0) {
    summaryBody.innerHTML =
      '<tr><td colspan="2">لا توجد بيانات لعرضها</td></tr>';
    return;
  }

  for (const [dept, count] of Object.entries(deptCounts)) {
    const row = document.createElement("tr");
    row.innerHTML = `
            <td>${dept}</td>
            <td>${count}</td>
        `;
    summaryBody.appendChild(row);
  }
}

function updateWaitingSummary(appointments) {
  const summaryBody = document.getElementById("waitingSummaryBody");
  summaryBody.innerHTML = "";

  const deptCounts = {};
  appointments.forEach((apt) => {
    if (apt.status === "انتظار") {
      if (!deptCounts[apt.department]) {
        deptCounts[apt.department] = 0;
      }
      deptCounts[apt.department]++;
    }
  });

  if (Object.keys(deptCounts).length === 0) {
    summaryBody.innerHTML =
      '<tr><td colspan="2">لا توجد بيانات لعرضها</td></tr>';
    return;
  }

  for (const [dept, count] of Object.entries(deptCounts)) {
    const row = document.createElement("tr");
    row.innerHTML = `
            <td>${dept}</td>
            <td>${count}</td>
        `;
    summaryBody.appendChild(row);
  }
}

function openSearchModal() {
  document.getElementById("searchModal").classList.add("active");
  setSearchOption("name");
}

function closeSearchModal() {
  document.getElementById("searchModal").classList.remove("active");
  document.getElementById("searchForm").reset();
}

function setSearchOption(option) {
  document
    .querySelectorAll(".form-group:not(.search-options)")
    .forEach((el) => {
      el.classList.add("hidden");
    });

  document
    .getElementById(
      `searchBy${option.charAt(0).toUpperCase() + option.slice(1)}`
    )
    .classList.remove("hidden");

  document.querySelectorAll(".search-option").forEach((el) => {
    el.classList.remove("active");
  });
  document
    .querySelector(`.search-option[data-option="${option}"]`)
    .classList.add("active");
}

async function handleSearch(e) {
  e.preventDefault();

  const activeOption = document.querySelector(".search-option.active").dataset
    .option;
  let searchValue = "";

  switch (activeOption) {
    case "name":
      searchValue = document.getElementById("searchName").value;
      break;
    case "id":
      searchValue = document.getElementById("searchId").value;
      break;
    case "phone":
      searchValue = document.getElementById("searchPhone").value;
      break;
    case "date":
      searchValue = document.getElementById("searchDate").value;
      break;
  }

  if (!searchValue) {
    alert("Please enter a search value");
    return;
  }

  try {
    const response = await fetch("/api/appointments/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        searchType: activeOption,
        searchValue: searchValue,
      }),
    });

    const results = await response.json();
    updateAppointmentsTable(results);
    closeSearchModal();
  } catch (error) {
    console.error("Search error:", error);
    alert("An error occurred during search");
  }
}

function openDepartmentsManagement() {
  document.getElementById("departmentsModal").classList.add("active");
  loadDepartments();
}

function closeDepartmentsModal() {
  document.getElementById("departmentsModal").classList.remove("active");
  document.getElementById("departmentForm").reset();
}

async function loadDepartments() {
  try {
    const response = await fetch("/api/departments", {
      credentials: 'include'
    });
    
    if (response.status === 401) {
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لعرض الأقسام");
      return;
    }
    
    const departments = await response.json();
    updateDepartmentsList(departments);
    updateDepartmentDropdowns(departments);
  } catch (error) {
    console.error("Load departments error:", error);
  }
}

function updateDepartmentsList(departments) {
  const departmentsList = document.getElementById("departmentsList");
  departmentsList.innerHTML = "";

  if (departments.length === 0) {
    departmentsList.innerHTML = '<tr><td colspan="2">لا توجد أقسام مضافة.</td></tr>';
    return;
  }

  departments.forEach((dept) => {
    const row = document.createElement("tr");
    row.innerHTML = `
            <td>${dept}</td>
            <td class="action-buttons">
                <button class="action-btn delete-btn" onclick="deleteDepartment('${dept}')">حذف</button>
            </td>
        `;
    departmentsList.appendChild(row);
  });
}

function updateDepartmentDropdown(departments) {
  const departmentSelect = document.getElementById("department");
  departmentSelect.innerHTML = '<option value="">اختر القسم</option>';

  departments.forEach((dept) => {
    const option = document.createElement("option");
    option.value = dept;
    option.textContent = dept;
    departmentSelect.appendChild(option);
  });
}

function updateDepartmentDropdowns(departments) {
  updateDepartmentDropdown(departments);

  const reportDeptSelect = document.getElementById("reportDepartment");
  const interactionDeptSelect = document.getElementById("interactionDepartment");

  [reportDeptSelect, interactionDeptSelect].forEach(select => {
    if (select) {
      select.innerHTML = '<option value="جميع الأقسام">جميع الأقسام</option>';
      departments.forEach(dept => {
        const option = document.createElement("option");
        option.value = dept;
        option.textContent = dept;
        select.appendChild(option);
      });
    }
  });
}


async function handleAddDepartment(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const departmentName = formData.get("departmentName");

  if (!departmentName.trim()) {
    alert("اسم القسم لا يمكن أن يكون فارغًا.");
    return;
  }

  try {
    const response = await fetch("/api/departments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ departmentName }),
    });

    const result = await response.json();

    if (result.success) {
      document.getElementById("departmentForm").reset();
    } else {
      alert(result.message || "Failed to add department");
    }
  } catch (error) {
    console.error("Add department error:", error);
    alert("An error occurred while adding the department");
  }
}

async function deleteDepartment(departmentName) {
  if (!confirm(`هل أنت متأكد أنك تريد حذف القسم "${departmentName}"؟`)) return;

  try {
    const response = await fetch("/api/departments", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ departmentName }),
    });

    const result = await response.json();

    if (result.success) {
    } else {
      alert(result.message || "Failed to delete department");
    }
  } catch (error) {
    console.error("Delete department error:", error);
    alert("An error occurred while deleting the department");
  }
}

function openUsersManagement() {
  document.getElementById("usersModal").classList.add("active");
  loadUsers();
}

function closeUsersModal() {
  document.getElementById("usersModal").classList.remove("active");
  document.getElementById("userForm").reset();
  isEditingUser = false;
  currentEditUsername = null;
  document.getElementById("userPassword").required = true;
  document.querySelector("#userForm button[type='submit']").textContent =
    "إضافة مستخدم";
  document.querySelector("#usersModal h2").textContent = "إدارة المستخدمين";
}

async function loadUsers() {
  try {
    const response = await fetch("/api/users", {
      credentials: 'include'
    });
    
    if (response.status === 401) {
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لعرض المستخدمين");
      return;
    }
    
    const result = await response.json();

    if (result.success) {
      updateUsersList(result.data);
    } else {
      console.error("Failed to load users");
    }
  } catch (error) {
    console.error("Load users error:", error);
  }
}

function updateUsersList(users) {
  const usersList = document.querySelector("#usersModal tbody");
  usersList.innerHTML = "";

  if (users.length === 0) {
    usersList.innerHTML = '<tr><td colspan="3">لا يوجد مستخدمون مضافون.</td></tr>';
    return;
  }

  users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
            <td>${user.username}</td>
            <td>${user.role}</td>
            <td class="action-buttons">
                <button class="action-btn edit-btn" onclick="editUser('${user.username}', '${user.role}')">تعديل</button>
                <button class="action-btn delete-btn" onclick="deleteUser('${user.username}')">حذف</button>
            </td>
        `;
    usersList.appendChild(row);
  });
}

function editUser(username, role) {
  isEditingUser = true;
  currentEditUsername = username;

  document.getElementById("userName").value = username;
  document.getElementById("userRole").value = role;
  document.getElementById("userPassword").required = false;

  document.querySelector("#userForm button[type='submit']").textContent =
    "تحديث المستخدم";
  document.querySelector("#usersModal h2").textContent = "تعديل المستخدم";
}

async function handleAddUser(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const userData = {
    userName: formData.get("userName"),
    userRole: formData.get("userRole"),
    userPassword: formData.get("userPassword"),
  };

  if (!userData.userName.trim() || !userData.userRole.trim()) {
    alert("اسم المستخدم والدور لا يمكن أن يكونا فارغين.");
    return;
  }
  if (!isEditingUser && !userData.userPassword.trim()) {
    alert("كلمة المرور مطلوبة لمستخدم جديد.");
    return;
  }

  try {
    let response;
    if (isEditingUser) {
      response = await fetch("/api/users", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: userData.userName,
          password: userData.userPassword || undefined,
          role: userData.userRole,
        }),
      });
    } else {
      response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(userData),
      });
    }

    const result = await response.json();

    if (result.success) {
      closeUsersModal();
    } else {
      alert(result.message || "Failed to process user");
    }
  } catch (error) {
    console.error("User operation error:", error);
    alert("An error occurred while processing the user");
  }
}

async function deleteUser(username) {
  if (!confirm(`هل أنت متأكد أنك تريد حذف المستخدم "${username}"؟`)) return;

  try {
    const response = await fetch("/api/users", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });

    const result = await response.json();

    if (result.success) {
    } else {
      alert(result.message || "Failed to delete user");
    }
  } catch (error) {
    console.error("Delete user error:", error);
    alert("An error occurred while deleting the user");
  }
}

async function deleteAllA() {
  if (!confirm("هل أنت متأكد أنك تريد حذف جميع المواعيد؟ هذا الإجراء لا يمكن التراجع عنه!")) return;

  try {
    const response = await fetch("/api/appointments", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      showLogin();
      return;
    }
    
    if (response.status === 403) {
      alert("ليس لديك صلاحية لحذف جميع المواعيد - هذه الصلاحية مخصصة للمديرين فقط");
      return;
    }

    const result = await response.json();

    if (result.success) {
      alert("تم حذف جميع المواعيد بنجاح.");
    } else {
      alert(result.message || "فشل في حذف جميع المواعيد.");
    }
  } catch (error) {
    console.error("Delete all appointments error:", error);
    alert("حدث خطأ أثناء حذف جميع المواعيد.");
  }
}

function toggleTheme() {
  const isLightTheme = document.body.classList.contains("light-theme");

  if (isLightTheme) {
    enableDarkTheme();
  } else {
    enableLightTheme();
  }
}

function enableLightTheme() {
  document.body.classList.add("light-theme");
  themeToggle.textContent = "☀️";
  localStorage.setItem("theme", "light");
}

function enableDarkTheme() {
  document.body.classList.remove("light-theme");
  themeToggle.textContent = "🌙";
  localStorage.setItem("theme", "dark");
}

function toggleMobileMenu() {
  console.log("toggleMobileMenu");
  const navRight = document.getElementById("navRight");
  const dropdowns = document.querySelectorAll(".dropdown");

  navRight.classList.toggle("active");

  dropdowns.forEach((dropdown) => {
    dropdown.classList.remove("active");
  });

  // قفل تمرير الصفحة أثناء فتح القائمة في الموبايل
  if (window.innerWidth <= 768) {
    if (navRight.classList.contains("active")) {
      document.body.classList.add("no-scroll");
    } else {
      document.body.classList.remove("no-scroll");
    }
  }
}

function formatDate(dateString) {
  const options = { year: "numeric", month: "short", day: "numeric" };
  return new Date(dateString).toLocaleDateString("ar-SA", options);
}

function formatTime(timeString) {
  return timeString;
}

function openReportsModal() {
  document.getElementById("reportsModal").classList.add("active");
  const today = new Date().toISOString().split('T')[0];
  document.getElementById("dailyReportDate").value = today;
  document.getElementById("reportStartDate").value = today;
  document.getElementById("reportEndDate").value = today;
  document.getElementById("interactionStartDate").value = today;
  document.getElementById("interactionEndDate").value = today;

  loadDepartments();

  document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.report-tab[data-section="dailyReportSection"]').classList.add('active');
  showReportSection('dailyReportSection');
}

function closeReportsModal() {
  document.getElementById("reportsModal").classList.remove("active");
  document.getElementById("dailyReportOutput").innerHTML = "";
  document.getElementById("comprehensiveReportOutput").innerHTML = "";
  document.getElementById("interactionReportOutput").innerHTML = "";
}

function showReportSection(sectionId) {
  document.querySelectorAll('.report-section').forEach(section => {
    section.classList.remove('active');
  });

  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
    targetSection.classList.add('active');
  }
  
  document.querySelectorAll('.report-tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.section === sectionId) {
      tab.classList.add('active');
    }
  });
}

async function generateDailyReport() {
  const date = document.getElementById("dailyReportDate").value;

  if (!date) {
    alert("يرجى اختيار تاريخ");
    return;
  }

  try {
    const response = await fetch(`/api/reports/daily?date=${date}`);
    const result = await response.json();

    if (result.success) {
      displayDailyReport(result.data, date);
    } else {
      alert(result.message || "فشل في إنشاء التقرير اليومي");
    }
  } catch (error) {
    console.error("Generate daily report error:", error);
    alert("حدث خطأ أثناء إنشاء التقرير اليومي");
  }
}

async function generateComprehensiveReport() {
  const startDate = document.getElementById("reportStartDate").value;
  const endDate = document.getElementById("reportEndDate").value;
  const department = document.getElementById("reportDepartment").value;

  if (!startDate || !endDate) {
    alert("يرجى اختيار تاريخ البداية والنهاية");
    return;
  }
  if (new Date(startDate) > new Date(endDate)) {
    alert("تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية.");
    return;
  }

  try {
    let url = `/api/reports/comprehensive?startDate=${startDate}&endDate=${endDate}`;
    if (department && department !== "جميع الأقسام") {
      url += `&department=${encodeURIComponent(department)}`;
    }

    const response = await fetch(url);
    const result = await response.json();

    if (result.success) {
      displayComprehensiveReport(result.data, startDate, endDate, department);
    } else {
      alert(result.message || "فشل في إنشاء التقرير الشامل");
    }
  } catch (error) {
    console.error("Generate comprehensive report error:", error);
    alert("حدث خطأ أثناء إنشاء التقرير الشامل");
  }
}

let interactionChartInstance = null;

async function generateInteractionReport() {
  const startDate = document.getElementById("interactionStartDate").value;
  const endDate = document.getElementById("interactionEndDate").value;
  const department = document.getElementById("interactionDepartment").value;

  if (!startDate || !endDate) {
    alert("يرجى اختيار تاريخ البداية والنهاية");
    return;
  }
  if (new Date(startDate) > new Date(endDate)) {
    alert("تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية.");
    return;
  }

  try {
    let url = `/api/reports/interaction?startDate=${startDate}&endDate=${endDate}`;
    if (department && department !== "جميع الأقسام") {
      url += `&department=${encodeURIComponent(department)}`;
    }

    const response = await fetch(url);
    const result = await response.json();

    if (result.success) {
      displayInteractionReport(result.data, result.summary, startDate, endDate, department);
    } else {
      alert(result.message || "فشل في إنشاء تقرير التفاعل");
    }
  } catch (error) {
    console.error("Generate interaction report error:", error);
    alert("حدث خطأ أثناء إنشاء تقرير التفاعل");
  }
}

function displayDailyReport(appointments, date) {
  const reportOutput = document.getElementById("dailyReportOutput");

  if (appointments.length === 0) {
    reportOutput.innerHTML = `
      <div class="report-header">
        <h3>تقرير المواعيد اليومي - تاريخ: ${date}</h3>
        <p>القسم: جميع الأقسام</p>
      </div>
      <div class="no-data">لا توجد مواعيد في هذا التاريخ</div>
    `;
    return;
  }

  let html = `
    <div class="report-header">
      <h3>تقرير المواعيد اليومي - تاريخ: ${date}</h3>
      <p>القسم: جميع الأقسام</p>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>رقم</th>
          <th>المريض</th>
          <th>الهوية</th>
          <th>الجوال</th>
          <th>القسم</th>
          <th>التاريخ</th>
          <th>الوقت</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>
  `;

  appointments.forEach((apt, index) => {
    html += `
      <tr>
        <td>${index + 1}</td>
        <td>${apt.patientName}</td>
        <td>${apt.patientId}</td>
        <td>${apt.patientPhone}</td>
        <td>${apt.department}</td>
        <td>${apt.appointmentDate}</td>
        <td>${apt.appointmentTime}</td>
        <td>${apt.status}</td>
      </tr>
    `;
  });

  const waitingCount = appointments.filter(a => a.status === "انتظار").length;
  const doneCount = appointments.filter(a => a.status === "منجز").length;

  html += `
      </tbody>
    </table>
    <div class="report-summary">
      الإجمالي: ${appointments.length} | انتظار: ${waitingCount} | منجز: ${doneCount}
    </div>
    <div class="report-actions">
      <button class="btn btn-print" onclick="printReport('dailyReportOutput')">طباعة التقرير</button>
    </div>
  `;

  reportOutput.innerHTML = html;
}

function displayComprehensiveReport(appointments, startDate, endDate, department) {
  const reportOutput = document.getElementById("comprehensiveReportOutput");
  const deptTitle = department === "جميع الأقسام" ? "جميع الأقسام" : department;

  if (appointments.length === 0) {
    reportOutput.innerHTML = `
      <div class="report-header">
        <h3>تقرير شامل - الفترة: ${startDate} إلى ${endDate}</h3>
        <p>القسم: ${deptTitle}</p>
      </div>
      <div class="no-data">لا توجد مواعيد في الفترة المحددة</div>
    `;
    return;
  }

  let html = `
    <div class="report-header">
      <h3>تقرير شامل - الفترة: ${startDate} إلى ${endDate}</h3>
      <p>القسم: ${deptTitle}</p>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>رقم</th>
          <th>المريض</th>
          <th>الهوية</th>
          <th>الجوال</th>
          <th>القسم</th>
          <th>التاريخ</th>
          <th>الوقت</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>
  `;

  appointments.forEach((apt, index) => {
    html += `
      <tr>
        <td>${index + 1}</td>
        <td>${apt.patientName}</td>
        <td>${apt.patientId}</td>
        <td>${apt.patientPhone}</td>
        <td>${apt.department}</td>
        <td>${apt.appointmentDate}</td>
        <td>${apt.appointmentTime}</td>
        <td>${apt.status}</td>
      </tr>
    `;
  });

  const waitingCount = appointments.filter(a => a.status === "انتظار").length;
  const doneCount = appointments.filter(a => a.status === "منجز").length;

  html += `
      </tbody>
    </table>
    <div class="report-summary">
      الإجمالي: ${appointments.length} | انتظار: ${waitingCount} | منجز: ${doneCount}
    </div>
    <div class="report-actions">
      <button class="btn btn-print" onclick="printReport('comprehensiveReportOutput')">طباعة التقرير</button>
    </div>
  `;

  reportOutput.innerHTML = html;
}

function displayInteractionReport(appointments, summary, startDate, endDate, department) {
  const reportOutput = document.getElementById("interactionReportOutput");
  const deptTitle = department === "جميع الأقسام" ? "جميع الأقسام" : department;

  if (interactionChartInstance) {
    interactionChartInstance.destroy();
  }

  if (appointments.length === 0) {
    reportOutput.innerHTML = `
      <div class="report-header">
        <h3>تقرير تفاعل - الفترة: ${startDate} إلى ${endDate}</h3>
        <p>القسم: ${deptTitle}</p>
      </div>
      <div class="no-data">لا توجد مواعيد في الفترة المحددة</div>
    `;
    return;
  }

  const waitingPercentage = summary.إجمالي > 0 ? ((summary.انتظار / summary.إجمالي) * 100).toFixed(1) : 0;
  const donePercentage = summary.إجمالي > 0 ? ((summary.منجز / summary.إجمالي) * 100).toFixed(1) : 0;

  let html = `
    <div class="report-header">
      <h3>تقرير تفاعل - الفترة: ${startDate} إلى ${endDate}</h3>
      <p>القسم: ${deptTitle}</p>
    </div>
    <div class="interaction-summary-cards">
      <div class="summary-item">
        <span class="summary-label">الانتظار:</span>
        <span class="summary-value">${summary.انتظار} (${waitingPercentage}%)</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">المنجز:</span>
        <span class="summary-value">${summary.منجز} (${donePercentage}%)</span>
      </div>
      <div class="summary-item total">
        <span class="summary-label">الإجمالي:</span>
        <span class="summary-value">${summary.إجمالي}</span>
      </div>
    </div>
    <div class="chart-container" style="width: 80%; margin: 20px auto;">
        <canvas id="interactionChart"></canvas>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>رقم</th>
          <th>المريض</th>
          <th>الهوية</th>
          <th>الجوال</th>
          <th>القسم</th>
          <th>التاريخ</th>
          <th>الوقت</th>
          <th>الحالة</th>
        </tr>
      </thead>
      <tbody>
  `;

  appointments.forEach((apt, index) => {
    html += `
      <tr>
        <td>${index + 1}</td>
        <td>${apt.patientName}</td>
        <td>${apt.patientId}</td>
        <td>${apt.patientPhone}</td>
        <td>${apt.department}</td>
        <td>${apt.appointmentDate}</td>
        <td>${apt.appointmentTime}</td>
        <td>${apt.status}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
    <div class="report-actions">
      <button class="btn btn-print" onclick="printReport('interactionReportOutput')">طباعة التقرير</button>
    </div>
  `;

  reportOutput.innerHTML = html;

  const ctx = document.getElementById('interactionChart').getContext('2d');
  interactionChartInstance = new Chart(ctx, {
      type: 'pie', 
      data: {
          labels: ['انتظار', 'منجز'],
          datasets: [{
              label: 'عدد المواعيد',
              data: [summary.انتظار, summary.منجز],
              backgroundColor: [
                  'rgba(255, 159, 64, 0.8)',
                  'rgba(75, 192, 192, 0.8)' 
              ],
              borderColor: [
                  'rgba(255, 159, 64, 1)',
                  'rgba(75, 192, 192, 1)'
              ],
              borderWidth: 1
          }]
      },
      options: {
          responsive: true,
          plugins: {
              legend: {
                  position: 'top',
                  labels: {
                    font: {
                      size: 14
                    }
                  }
              },
              title: {
                  display: true,
                  text: 'توزيع حالة المواعيد',
                  font: {
                    size: 16
                  }
              }
          }
      }
  });
}

function printReport(elementId) {
  const printContent = document.getElementById(elementId).innerHTML;

  // افتح نافذة الطباعة
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>تقرير</title>
      <style>
        body {
          font-family: "Tahoma", "Arial", sans-serif;
          margin: 20px;
          direction: rtl;
          text-align: right;
        }
        .report-header {
          text-align: center;
          margin-bottom: 20px;
        }
        .report-header h3 {
          margin: 0;
          font-size: 20px;
        }
        .report-header p {
          margin: 5px 0;
          font-size: 14px;
          color: #555;
        }
        .report-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .report-table th, .report-table td {
          border: 1px solid #444;
          padding: 8px;
          font-size: 14px;
          text-align: center;
        }
        .report-table th {
          background-color: #f2f2f2;
          font-weight: bold;
        }
        .report-summary {
          font-size: 14px;
          margin-top: 10px;
          font-weight: bold;
        }
        .report-actions {
          display: none; /* عشان زر الطباعة ما يظهرش في نسخة الطباعة */
        }
      </style>
    </head>
    <body>
      ${printContent}
    </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  // اطبع
  printWindow.print();

  // اقفل بعد الطباعة
  printWindow.onafterprint = function() {
    printWindow.close();
  };
}

async function downloadBackup() {
  if (!confirm("هل أنت متأكد أنك تريد تنزيل نسخة احتياطية من البيانات؟")) return;
  try {
    const response = await fetch('/api/backup');
    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      alert('تم تنزيل النسخة الاحتياطية بنجاح!');
    } else {
      alert('فشل في إنشاء النسخة الاحتياطية');
    }
  } catch (error) {
    console.error('Download backup error:', error);
    alert('حدث خطأ أثناء إنشاء النسخة الاحتياطية');
  }
}