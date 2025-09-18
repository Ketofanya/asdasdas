require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const { QuickDB } = require("quick.db");
const session = require("express-session");
const cors = require("cors");
const db = new QuickDB({ filePath: "./database.db" });

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  session({
    name: "ahams.sid",
    secret: process.env.SECRET || "hospital-appointment-secret-key-2029",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // set to true if you serve over HTTPS
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

(async () => {
  if (!(await db.has("appointments"))) {
    await db.set("appointments", []);
  }
  if (!(await db.has("departments"))) {
    await db.set("departments", []);
  }
  if (!(await db.has("users"))) {
    await db.set("users", [
      {
        username: "mainadmin",
        password: process.env.ADMIN_PASSWORD,
        role: "admin",
      },
    ]);
  }
  if (!(await db.has("settings"))) {
    await db.set("settings", {
      appointmentNumberStart: 1,
      nextSerialNumber: 1,
    });
  }
  if (!(await db.has("logs"))) {
    await db.set("logs", []);
  }
  if (!(await db.has("activeSessions"))) {
    await db.set("activeSessions", {});
  }
})();

// Validate that any existing session is still the active one for the username
app.use(async (req, res, next) => {
  try {
    if (req.session && req.session.user) {
      const activeSessions = (await db.get("activeSessions")) || {};
      const username = req.session.user.username;
      const activeSessionId = activeSessions[username];
      if (!activeSessionId || activeSessionId !== req.sessionID) {
        // Invalidate stale session
        req.session.destroy(() => {});
        return res
          .status(401)
          .json({ success: false, message: "Authentication required" });
      }
    }
  } catch (e) {
    // fallthrough
  }
  next();
});

const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res
      .status(401)
      .json({ success: false, message: "Authentication required" });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res
      .status(401)
      .json({ success: false, message: "Authentication required" });
  }
  if (req.session.user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, message: "Admin access required" });
  }
  next();
};

const requireStaffOrAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res
      .status(401)
      .json({ success: false, message: "Authentication required" });
  }
  if (req.session.user.role !== "admin" && req.session.user.role !== "staff") {
    return res
      .status(403)
      .json({ success: false, message: "Staff or admin access required" });
  }
  next();
};

// Routes
app.get("/", async (req, res) => {
  const appointments = (await db.get("appointments")) || [];
  const departments = (await db.get("departments")) || [];
  const users = (await db.get("users")) || [];
  const settings = (await db.get("settings")) || {
    appointmentNumberStart: 1,
    nextSerialNumber: 1,
  };

  res.render("index", {
    appointments,
    departments,
    users,
    currentUser: req.session.user || null,
    settings,
  });
});

// Admin Settings Page (stable)
app.get("/settings", requireAdmin, async (req, res) => {
  try {
    const users = (await db.get("users")) || [];
    const settings = (await db.get("settings")) || {
      appointmentNumberStart: 1,
      nextSerialNumber: 1,
    };
    const logs = (await db.get("logs")) || [];
    res.render("settings", {
      currentUser: req.session.user || null,
      users,
      settings,
      logs,
    });
  } catch (e) {
    res.status(500).send("Settings page unavailable");
  }
});

// API for all data
app.get("/api/appointments", requireStaffOrAdmin, async (req, res) => {
  const appointments = (await db.get("appointments")) || [];
  res.json(appointments);
});

app.delete("/api/appointments", requireStaffOrAdmin, async (req, res) => {
  let id = req.body?.id;
  if (!id) {
    // حذف جميع المواعيد - يحتاج صلاحية admin فقط
    if (req.session.user.role !== "admin") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Admin access required to delete all appointments",
        });
    }
    await db.set("appointments", []);
    // Log action
    {
      const logs = (await db.get("logs")) || [];
      logs.push({
        ts: new Date().toISOString(),
        user: req.session.user.username,
        action: "delete-all",
      });
      await db.set("logs", logs);
    }
    io.emit("appointmentUpdated", []);
    res.json({ success: true });
  } else {
    let allAppointments = (await db.get("appointments")) || [];
    const updatedAppointments = allAppointments.filter((d) => d.id !== id);
    await db.set("appointments", updatedAppointments);
    // Log action
    {
      const logs = (await db.get("logs")) || [];
      logs.push({
        ts: new Date().toISOString(),
        user: req.session.user.username,
        action: "delete",
        appointmentId: id,
      });
      await db.set("logs", logs);
    }
    io.emit("appointmentUpdated", updatedAppointments);
    res.json({ success: true });
  }
});

app.get("/api/departments", async (req, res) => {
  const departments = (await db.get("departments")) || [];
  res.json(departments);
});

app.post("/api/appointments", requireStaffOrAdmin, async (req, res) => {
  const {
    patientName,
    patientId,
    patientPhone,
    patientBirthDate,
    appointmentDate,
    appointmentTime,
    department,
    isHistorical,
    serialNumber: requestedSerialNumber,
  } = req.body;

  if (
    !patientName ||
    !patientId ||
    !patientPhone ||
    !appointmentDate ||
    !appointmentTime ||
    !department
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }
  if (
    String(patientId).replace(/\D/g, "").length < 10 ||
    String(patientPhone).replace(/\D/g, "").length < 10
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message: "رقم الهوية ورقم الجوال يجب أن لا يقل عن 10 أرقام",
      });
  }

  const user = req.session.user;
  let canUseHistorical = user.role === "admin";
  if (!canUseHistorical) {
    const users = (await db.get("users")) || [];
    const found = users.find((u) => u.username === user.username);
    canUseHistorical = !!(
      found &&
      found.permissions &&
      found.permissions.canAddHistorical === true
    );
  }

  const settings = (await db.get("settings")) || {
    appointmentNumberStart: 1,
    nextSerialNumber: 1,
  };
  let serialNumberToUse;
  if (isHistorical && canUseHistorical && requestedSerialNumber) {
    serialNumberToUse = parseInt(requestedSerialNumber, 10);
    if (!Number.isFinite(serialNumberToUse) || serialNumberToUse < 1) {
      return res
        .status(400)
        .json({ success: false, message: "رقم الموعد غير صالح" });
    }
  } else {
    serialNumberToUse =
      settings.nextSerialNumber || settings.appointmentNumberStart || 1;
    settings.nextSerialNumber = serialNumberToUse + 1;
    await db.set("settings", settings);
  }

  const newAppointment = {
    id: Date.now().toString(),
    serialNumber: serialNumberToUse,
    patientName,
    patientId,
    patientPhone,
    patientBirthDate,
    appointmentDate,
    appointmentTime,
    department,
    status: "انتظار",
    createdAt: new Date().toISOString(),
    createdBy: user.username,
  };

  const appointments = (await db.get("appointments")) || [];
  appointments.push(newAppointment);
  await db.set("appointments", appointments);

  const logs = (await db.get("logs")) || [];
  logs.push({
    ts: new Date().toISOString(),
    user: user.username,
    action: "create",
    appointmentId: newAppointment.id,
    details: { serialNumber: serialNumberToUse, department },
  });
  await db.set("logs", logs);

  io.emit("appointmentUpdated", appointments);

  res.json({ success: true, message: "Appointment added successfully" });
});

app.put("/api/appointments/:id", requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const appointments = (await db.get("appointments")) || [];

  const appointmentIndex = appointments.findIndex((apt) => apt.id === id);
  if (appointmentIndex === -1) {
    return res.json({ success: false, message: "Appointment not found" });
  }

  appointments[appointmentIndex].status = status;
  await db.set("appointments", appointments);

  {
    const logs = (await db.get("logs")) || [];
    logs.push({
      ts: new Date().toISOString(),
      user: req.session.user.username,
      action: "update-status",
      appointmentId: id,
      details: { status },
    });
    await db.set("logs", logs);
  }

  io.emit("appointmentUpdated", appointments);

  res.json({ success: true, message: "Status updated successfully" });
});

// Toggle appointment status
app.put(
  "/api/appointments/toggle-status/:id",
  requireStaffOrAdmin,
  async (req, res) => {
    const { id } = req.params;
    const appointments = (await db.get("appointments")) || [];

    const appointmentIndex = appointments.findIndex((apt) => apt.id === id);
    if (appointmentIndex === -1) {
      return res.json({ success: false, message: "Appointment not found" });
    }

    // تبديل الحالة بين "منجز" و "انتظار"
    appointments[appointmentIndex].status =
      appointments[appointmentIndex].status === "منجز" ? "انتظار" : "منجز";

    await db.set("appointments", appointments);

    // Log action
    {
      const logs = (await db.get("logs")) || [];
      logs.push({
        ts: new Date().toISOString(),
        user: req.session.user.username,
        action: "toggle-status",
        appointmentId: id,
        details: { status: appointments[appointmentIndex].status },
      });
      await db.set("logs", logs);
    }

    // Send update to all clients
    io.emit("appointmentUpdated", appointments);

    res.json({ success: true, message: "Status updated successfully" });
  }
);

// Update appointment data
app.put("/api/appointments/edit/:id", requireStaffOrAdmin, async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;
  const appointments = (await db.get("appointments")) || [];

  const appointmentIndex = appointments.findIndex((apt) => apt.id === id);
  if (appointmentIndex === -1) {
    return res.json({ success: false, message: "Appointment not found" });
  }

  // Validation for ID/phone if provided
  if (
    updatedData.patientId &&
    String(updatedData.patientId).replace(/\D/g, "").length < 10
  ) {
    return res.json({
      success: false,
      message: "رقم الهوية يجب أن لا يقل عن 10 أرقام",
    });
  }
  if (
    updatedData.patientPhone &&
    String(updatedData.patientPhone).replace(/\D/g, "").length < 10
  ) {
    return res.json({
      success: false,
      message: "رقم الجوال يجب أن لا يقل عن 10 أرقام",
    });
  }

  // تحديث البيانات مع الحفاظ على الحالة وتاريخ الإنشاء
  appointments[appointmentIndex] = {
    ...appointments[appointmentIndex],
    ...updatedData,
  };

  await db.set("appointments", appointments);

  // Log action
  {
    const logs = (await db.get("logs")) || [];
    logs.push({
      ts: new Date().toISOString(),
      user: req.session.user.username,
      action: "edit",
      appointmentId: id,
    });
    await db.set("logs", logs);
  }

  // Send update to all clients
  io.emit("appointmentUpdated", appointments);

  res.json({ success: true, message: "Appointment updated successfully" });
});

// Search appointments
app.post("/api/appointments/search", requireStaffOrAdmin, async (req, res) => {
  const { searchType, searchValue } = req.body;
  const appointments = (await db.get("appointments")) || [];

  let results = [];

  switch (searchType) {
    case "name":
      results = appointments.filter((a) => a.patientName.includes(searchValue));
      break;
    case "id":
      results = appointments.filter((a) => a.patientId.includes(searchValue));
      break;
    case "phone":
      results = appointments.filter((a) =>
        a.patientPhone.includes(searchValue)
      );
      break;
    case "date":
      results = appointments.filter((a) => a.appointmentDate === searchValue);
      break;
    default:
      results = appointments;
  }

  res.json(results);
});

// Department management
app.post("/api/departments", requireAdmin, async (req, res) => {
  const { departmentName } = req.body;
  const departments = (await db.get("departments")) || [];

  if (!departments.includes(departmentName)) {
    departments.push(departmentName);
    await db.set("departments", departments);

    // Send update to all clients
    io.emit("departmentsUpdated", departments);

    res.json({ success: true, message: "Department added successfully" });
  } else {
    res.json({ success: false, message: "Department already exists" });
  }
});

app.delete("/api/departments", requireAdmin, async (req, res) => {
  const { departmentName } = req.body;
  const departments = (await db.get("departments")) || [];

  const updatedDepartments = departments.filter((d) => d !== departmentName);
  await db.set("departments", updatedDepartments);

  // Send update to all clients
  io.emit("departmentsUpdated", updatedDepartments);

  res.json({ success: true, message: "Department deleted successfully" });
});

// User management
app.get("/api/users", requireAdmin, async (req, res) => {
  const users = (await db.get("users")) || [];
  res.json({ success: true, data: users });
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const { userName, userRole, userPassword } = req.body;
  const users = (await db.get("users")) || [];

  const newUser = {
    username: userName,
    password: userPassword,
    role: userRole,
  };

  users.push(newUser);
  await db.set("users", users);

  // Send update to all clients
  io.emit("usersUpdated", users);
  
  // إرسال تحديث الصلاحيات للمستخدم الجديد
  io.emit("permissionsUpdated", {
    username: userName,
    permissions: newUser.permissions || {}
  });

  res.json({ success: true, message: "User added successfully" });
});

app.put("/api/users", requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  const users = (await db.get("users")) || [];

  const userIndex = users.findIndex((u) => u.username === username);
  if (userIndex !== -1) {
    users[userIndex] = {
      ...users[userIndex],
      username,
      password: password ?? users[userIndex].password,
      role,
    };
    await db.set("users", users);

    // Send update to all clients
    io.emit("usersUpdated", users);
    
    // إرسال تحديث الصلاحيات للمستخدم المحدث
    io.emit("permissionsUpdated", {
      username: username,
      permissions: users[userIndex].permissions || {}
    });

    res.json({ success: true, message: "User updated successfully" });
  } else {
    res.json({ success: false, message: "User not found" });
  }
});

app.delete("/api/users", requireAdmin, async (req, res) => {
  const { username } = req.body;
  const users = (await db.get("users")) || [];

  const foundUser = users.find((d) => d.username == username);
  if (!foundUser) {
    res.json({ success: false, message: "User not found" });
  } else {
    const updatedUsers = users.filter((d) => d.username !== username);
    await db.set("users", updatedUsers);

    // Send update to all clients
    io.emit("usersUpdated", updatedUsers);

    res.json({ success: true, message: "User deleted successfully" });
  }
});

// User permissions: historical appointments access
app.put("/api/users/permissions/historical", requireAdmin, async (req, res) => {
  const { username, allowed } = req.body;
  if (!username || typeof allowed === "undefined") {
    return res
      .status(400)
      .json({ success: false, message: "username and allowed are required" });
  }
  const users = (await db.get("users")) || [];
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1)
    return res.status(404).json({ success: false, message: "User not found" });
  users[idx].permissions = users[idx].permissions || {};
  users[idx].permissions.canAddHistorical = !!allowed;
  await db.set("users", users);
  io.emit("usersUpdated", users);
  
  // إرسال تحديث الصلاحيات للمستخدم المحدد
  io.emit("permissionsUpdated", {
    username: username,
    permissions: users[idx].permissions
  });
  
  res.json({ success: true });
});

// Appointment numbering settings
app.get("/api/settings/appointment-number", requireAdmin, async (req, res) => {
  const settings = (await db.get("settings")) || {
    appointmentNumberStart: 1,
    nextSerialNumber: 1,
  };
  res.json({
    success: true,
    data: {
      appointmentNumberStart: settings.appointmentNumberStart,
      nextSerialNumber: settings.nextSerialNumber,
    },
  });
});

app.put("/api/settings/appointment-number", requireAdmin, async (req, res) => {
  const { startFrom, resetCounter } = req.body;
  const settings = (await db.get("settings")) || {
    appointmentNumberStart: 1,
    nextSerialNumber: 1,
  };
  if (typeof startFrom === "number" && startFrom >= 1) {
    settings.appointmentNumberStart = startFrom;
    if (resetCounter) settings.nextSerialNumber = startFrom;
  }
  await db.set("settings", settings);
  res.json({ success: true, data: settings });
});

// Logs endpoint for admin
app.get("/api/logs", requireAdmin, async (req, res) => {
  const logs = (await db.get("logs")) || [];
  res.json({ success: true, data: logs });
});

app.get("/api/reports/daily", requireStaffOrAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    const appointments = (await db.get("appointments")) || [];

    const dailyAppointments = appointments.filter(
      (apt) => apt.appointmentDate === date
    );

    res.json({ success: true, data: dailyAppointments });
  } catch (error) {
    console.error("Daily report error:", error);
    res.json({ success: false, message: "Failed to generate daily report" });
  }
});

app.get("/api/reports/comprehensive", requireStaffOrAdmin, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    const appointments = (await db.get("appointments")) || [];

    let filteredAppointments = appointments;

    if (startDate && endDate) {
      filteredAppointments = filteredAppointments.filter(
        (apt) =>
          apt.appointmentDate >= startDate && apt.appointmentDate <= endDate
      );
    }

    if (department && department !== "جميع الأقسام") {
      filteredAppointments = filteredAppointments.filter(
        (apt) => apt.department === department
      );
    }

    res.json({ success: true, data: filteredAppointments });
  } catch (error) {
    console.error("Comprehensive report error:", error);
    res.json({
      success: false,
      message: "Failed to generate comprehensive report",
    });
  }
});

app.get("/api/reports/interaction", requireStaffOrAdmin, async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    const appointments = (await db.get("appointments")) || [];

    let filteredAppointments = appointments;

    if (startDate && endDate) {
      filteredAppointments = filteredAppointments.filter(
        (apt) =>
          apt.appointmentDate >= startDate && apt.appointmentDate <= endDate
      );
    }

    if (department && department !== "جميع الأقسام") {
      filteredAppointments = filteredAppointments.filter(
        (apt) => apt.department === department
      );
    }

    // تحليل التفاعل - عدد المواعيد لكل حالة
    const interactionSummary = {
      انتظار: filteredAppointments.filter((a) => a.status === "انتظار").length,
      منجز: filteredAppointments.filter((a) => a.status === "منجز").length,
      إجمالي: filteredAppointments.length,
    };

    res.json({
      success: true,
      data: filteredAppointments,
      summary: interactionSummary,
    });
  } catch (error) {
    console.error("Interaction report error:", error);
    res.json({
      success: false,
      message: "Failed to generate interaction report",
    });
  }
});

// Backup route
app.get("/api/backup", requireAdmin, async (req, res) => {
  try {
    const appointments = (await db.get("appointments")) || [];
    const departments = (await db.get("departments")) || [];
    const users = (await db.get("users")) || [];

    const backupData = {
      appointments,
      departments,
      users,
      backupDate: new Date().toISOString(),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", "attachment; filename=backup.json");
    res.send(JSON.stringify(backupData));
  } catch (error) {
    console.error("Backup error:", error);
    res.json({ success: false, message: "Failed to create backup" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const users = (await db.get("users")) || [];

  const user = users.find(
    (u) => u.username === username && u.password === password
  );

  if (user) {
    // تحقق من جلسة نشطة مسبقاً لنفس المستخدم
    const activeSessions = (await db.get("activeSessions")) || {};
    const existingSessionId = activeSessions[user.username];
    if (existingSessionId && existingSessionId !== req.sessionID) {
      // تأكيد أن الجلسة القديمة مازالت موجودة في مخزن الجلسات، وإلا يتم تنظيف القفل
      const store = req.sessionStore;
      await new Promise((resolve) => {
        store.get(existingSessionId, async (err, sess) => {
          try {
            if (err) {
              // في حالة الخطأ، اعتبر الجلسة غير صالحة ونظف القفل
              delete activeSessions[user.username];
              await db.set("activeSessions", activeSessions);
              resolve();
              return;
            }
            if (!sess) {
              // الجلسة غير موجودة بالفعل - نظف القفل
              delete activeSessions[user.username];
              await db.set("activeSessions", activeSessions);
              resolve();
              return;
            }
            // الجلسة القديمة مازالت حية - ارفض الدخول
            res
              .status(409)
              .json({
                success: false,
                message:
                  "هذا الحساب مستخدم حالياً في جلسة أخرى. برجاء تسجيل الخروج من الجلسة الأخرى أولاً.",
              });
            resolve();
          } catch (_) {
            resolve();
          }
        });
      });
      if (res.headersSent) return; // تم الرد بالفعل بحالة 409
    }

    // حفظ معلومات المستخدم في الجلسة وتسجيلها كجلسة نشطة
    // التأكد من تحديث الصلاحيات من قاعدة البيانات
    const updatedUser = users.find(u => u.username === user.username);
    req.session.user = {
      username: user.username,
      role: user.role,
      permissions: updatedUser ? (updatedUser.permissions || {}) : {},
    };
    activeSessions[user.username] = req.sessionID;
    await db.set("activeSessions", activeSessions);
    res.json({
      success: true,
      user: {
        username: user.username,
        role: user.role,
        permissions: updatedUser ? (updatedUser.permissions || {}) : {},
      },
    });
  } else {
    res.json({
      success: false,
      message: "Incorrect username or password",
    });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  (async () => {
    try {
      const username =
        req.session && req.session.user ? req.session.user.username : null;
      if (username) {
        const activeSessions = (await db.get("activeSessions")) || {};
        if (activeSessions[username] === req.sessionID) {
          delete activeSessions[username];
          await db.set("activeSessions", activeSessions);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      req.session.destroy((err) => {
        if (err) {
          return res
            .status(500)
            .json({ success: false, message: "Could not log out" });
        }
        res.json({ success: true, message: "Logged out successfully" });
      });
    }
  })();
});

// Check session
app.get("/api/session", async (req, res) => {
  if (req.session.user) {
    try {
      // التأكد من تحديث الصلاحيات من قاعدة البيانات
      const users = (await db.get("users")) || [];
      const updatedUser = users.find(u => u.username === req.session.user.username);
      
      if (updatedUser) {
        // تحديث الصلاحيات في الجلسة
        req.session.user.permissions = updatedUser.permissions || {};
      }
      
      res.json({ success: true, user: req.session.user });
    } catch (error) {
      console.error("Session check error:", error);
      res.json({ success: true, user: req.session.user });
    }
  } else {
    res.json({ success: false, message: "No active session" });
  }
});

// Socket.io for real-time updates
io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
