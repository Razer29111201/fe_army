import db from '../config/database.js';
import { getBranchFilter } from '../utils/branchHelper.js';

// Dashboard ADMIN - Toàn quyền xem
export const getAdmin = async (req, res, next) => {
  try {
    const branchId = getBranchFilter(req);
    const branchFilter = branchId ? ' AND branch_id = ?' : '';
    const branchClassFilter = branchId ? ' AND c.branch_id = ?' : '';
    const params = branchId ? [branchId] : [];

    // Students stats
    const [[students]] = await db.query(`
      SELECT COUNT(*) as total, 
        SUM(status = 'active') as active, 
        SUM(status = 'pending') as pending,
        SUM(fee_status = 'expiring_soon') as expiring_soon,
        SUM(fee_status = 'expired') as expired
      FROM students WHERE 1=1${branchFilter}`, params);

    const [[classes]] = await db.query(`SELECT COUNT(*) as total, SUM(status = 'active') as active FROM classes WHERE 1=1${branchFilter}`, params);

    // Leads stats
    const [[leads]] = await db.query(`
      SELECT COUNT(*) as total, 
        SUM(status = 'scheduled') as scheduled,
        SUM(status = 'waiting') as waiting,
        SUM(status = 'trial') as trial,
        SUM(status = 'converted') as converted,
        SUM(scheduled_date = CURDATE() AND status IN ('scheduled', 'trial')) as today
      FROM leads WHERE 1=1${branchFilter}`, params);

    // Sessions
    const [[sessions]] = await db.query(
      `SELECT COUNT(*) as total, SUM(s.session_date = CURDATE()) as today, SUM(s.attendance_submitted = 1) as submitted 
       FROM sessions s JOIN classes c ON s.class_id = c.id WHERE 1=1${branchClassFilter}`, params
    );

    // Users count
    const [[teachers]] = await db.query("SELECT COUNT(*) as total FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'TEACHER' AND u.is_active = 1");
    const [[ecs]] = await db.query("SELECT COUNT(*) as total FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'EC' AND u.is_active = 1");

    // Sale report summary (tháng hiện tại)
    const currentMonth = new Date().toISOString().slice(0, 7);
    let saleStats = { total_checkin: 0, total_revenue: 0, total_deposit: 0, total_expected: 0, total_converted: 0 };
    try {
      const [[stats]] = await db.query(`
        SELECT 
          COALESCE(SUM(checkin_count), 0) as total_checkin,
          COALESCE(SUM(revenue), 0) as total_revenue,
          COALESCE(SUM(deposit_total), 0) as total_deposit,
          COALESCE(SUM(expected_revenue), 0) as total_expected,
          COALESCE(SUM(leads_converted), 0) as total_converted
        FROM sale_reports 
        WHERE DATE_FORMAT(report_month, '%Y-%m') = ?
          ${branchId ? 'AND branch_id = ?' : ''}
      `, branchId ? [currentMonth, branchId] : [currentMonth]);
      if (stats) saleStats = stats;
    } catch (e) { /* table may not exist */ }

    // Học viên sắp hết phí
    let expiringStudents = [];
    try {
      const [rows] = await db.query(`
        SELECT s.id, s.full_name, s.student_code, s.parent_phone, s.remaining_sessions, s.fee_status,
               b.code as branch_code,
               (SELECT c.class_name FROM class_students cs JOIN classes c ON cs.class_id = c.id 
                WHERE cs.student_id = s.id AND cs.status = 'active' LIMIT 1) as class_name
        FROM students s
        JOIN branches b ON s.branch_id = b.id
        WHERE s.fee_status IN ('expiring_soon', 'expired') AND s.status = 'active'
          ${branchId ? 'AND s.branch_id = ?' : ''}
        ORDER BY s.remaining_sessions ASC LIMIT 10
      `, branchId ? [branchId] : []);
      expiringStudents = rows;
    } catch (e) { /* fee_status column may not exist */ }

    // Recent students
    const [recentStudents] = await db.query(
      `SELECT s.id, s.full_name, s.student_code, s.created_at, b.code as branch_code 
       FROM students s JOIN branches b ON s.branch_id = b.id 
       WHERE 1=1${branchFilter.replace('branch_id', 's.branch_id')} ORDER BY s.created_at DESC LIMIT 5`, params
    );

    // Recent leads
    const [recentLeads] = await db.query(
      `SELECT l.id, l.code, l.student_name, l.customer_phone, DATE_FORMAT(l.scheduled_date, '%Y-%m-%d') as scheduled_date, 
              l.scheduled_time, l.status, l.trial_sessions_attended, l.trial_sessions_max, s.name as subject_name, b.code as branch_code
       FROM leads l 
       LEFT JOIN subjects s ON l.subject_id = s.id 
       JOIN branches b ON l.branch_id = b.id
       WHERE l.status IN ('scheduled', 'waiting', 'trial')${branchFilter.replace('branch_id', 'l.branch_id')}
       ORDER BY CASE WHEN l.status = 'waiting' THEN 0 ELSE 1 END, l.scheduled_date, l.scheduled_time LIMIT 8`, params
    );

    // Today sessions
    const [todaySessions] = await db.query(
      `SELECT s.id, s.session_number, s.start_time, s.end_time, s.attendance_submitted, c.class_name, t.full_name as teacher_name, b.code as branch_code
       FROM sessions s 
       JOIN classes c ON s.class_id = c.id 
       JOIN branches b ON c.branch_id = b.id
       LEFT JOIN users t ON c.teacher_id = t.id
       WHERE s.session_date = CURDATE()${branchClassFilter} ORDER BY b.code, s.start_time LIMIT 10`, params
    );

    // Pending students
    const [pendingStudents] = await db.query(
      `SELECT s.id, s.full_name, s.student_code, s.parent_phone, s.created_at, b.code as branch_code, sub.name as subject_name
       FROM students s 
       JOIN branches b ON s.branch_id = b.id
       LEFT JOIN subjects sub ON s.subject_id = sub.id
       WHERE s.status = 'pending'${branchFilter.replace('branch_id', 's.branch_id')} 
       ORDER BY s.created_at DESC LIMIT 5`, params
    );

    res.json({
      success: true,
      data: {
        students, classes, teachers: teachers.total, ecs: ecs.total,
        leads, sessions,
        saleStats, expiringStudents,
        recentStudents, recentLeads, todaySessions, pendingStudents
      }
    });
  } catch (error) { next(error); }
};

// Dashboard CHỦ - Giống Admin + báo cáo tài chính
export const getOwner = async (req, res, next) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Tổng quan
    const [[students]] = await db.query(`
      SELECT COUNT(*) as total, 
        SUM(status = 'active') as active,
        SUM(fee_status = 'expiring_soon') as expiring_soon,
        SUM(fee_status = 'expired') as expired
      FROM students`);

    const [[classes]] = await db.query(`SELECT COUNT(*) as total, SUM(status = 'active') as active FROM classes`);

    const [[leads]] = await db.query(`
      SELECT COUNT(*) as total, 
        SUM(status = 'converted') as converted,
        SUM(MONTH(created_at) = MONTH(CURDATE())) as this_month
      FROM leads`);

    // Báo cáo sale tổng
    let saleStats = { total_checkin: 0, total_revenue: 0, total_deposit: 0, total_expected: 0 };
    try {
      const [[stats]] = await db.query(`
        SELECT 
          COALESCE(SUM(checkin_count), 0) as total_checkin,
          COALESCE(SUM(revenue), 0) as total_revenue,
          COALESCE(SUM(deposit_total), 0) as total_deposit,
          COALESCE(SUM(expected_revenue), 0) as total_expected
        FROM sale_reports 
        WHERE DATE_FORMAT(report_month, '%Y-%m') = ?
      `, [currentMonth]);
      if (stats) saleStats = stats;
    } catch (e) { }

    // Top EC theo doanh thu
    let topEcs = [];
    try {
      const [rows] = await db.query(`
        SELECT sr.ec_id, u.full_name as ec_name, b.code as branch_code,
               sr.revenue, sr.kpi_percent, sr.checkin_count, sr.leads_converted
        FROM sale_reports sr
        JOIN users u ON sr.ec_id = u.id
        LEFT JOIN user_branches ub ON u.id = ub.user_id
        LEFT JOIN branches b ON ub.branch_id = b.id
        WHERE DATE_FORMAT(sr.report_month, '%Y-%m') = ?
        ORDER BY sr.revenue DESC LIMIT 10
      `, [currentMonth]);
      topEcs = rows;
    } catch (e) { }

    // Doanh thu theo cơ sở
    let revenueByBranch = [];
    try {
      const [rows] = await db.query(`
        SELECT b.id, b.name, b.code,
               COALESCE(SUM(sr.revenue), 0) as revenue,
               COALESCE(SUM(sr.deposit_total), 0) as deposit,
               COALESCE(SUM(sr.expected_revenue), 0) as expected
        FROM branches b
        LEFT JOIN sale_reports sr ON b.id = sr.branch_id 
          AND DATE_FORMAT(sr.report_month, '%Y-%m') = ?
        WHERE b.is_active = 1
        GROUP BY b.id
        ORDER BY revenue DESC
      `, [currentMonth]);
      revenueByBranch = rows;
    } catch (e) { }

    // Học viên sắp hết phí
    let expiringStudents = [];
    try {
      const [rows] = await db.query(`
        SELECT s.id, s.full_name, s.student_code, s.remaining_sessions, s.fee_status,
               b.code as branch_code
        FROM students s
        JOIN branches b ON s.branch_id = b.id
        WHERE s.fee_status IN ('expiring_soon', 'expired') AND s.status = 'active'
        ORDER BY s.remaining_sessions ASC LIMIT 15
      `);
      expiringStudents = rows;
    } catch (e) { }

    res.json({
      success: true,
      data: {
        students, classes, leads,
        saleStats, topEcs, revenueByBranch, expiringStudents,
        currentMonth
      }
    });
  } catch (error) { next(error); }
};

// Dashboard HOEC - Báo cáo sale team
export const getHoec = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Lấy EC dưới quyền
    let myEcs = [];
    try {
      const [rows] = await db.query(`
        SELECT u.id, u.full_name, ub.branch_id, b.code as branch_code
        FROM hoec_ec_assignments hea
        JOIN users u ON hea.ec_id = u.id
        LEFT JOIN user_branches ub ON u.id = ub.user_id
        LEFT JOIN branches b ON ub.branch_id = b.id
        WHERE hea.hoec_id = ? AND u.is_active = 1
      `, [userId]);
      myEcs = rows;
    } catch (e) { }

    const ecIds = myEcs.length > 0 ? myEcs.map(e => e.id) : [0];

    // Tổng hợp sale
    let saleStats = { total_checkin: 0, total_revenue: 0, total_deposit: 0, total_expected: 0, avg_kpi: 0 };
    try {
      const [[stats]] = await db.query(`
        SELECT 
          COALESCE(SUM(checkin_count), 0) as total_checkin,
          COALESCE(SUM(revenue), 0) as total_revenue,
          COALESCE(SUM(deposit_total), 0) as total_deposit,
          COALESCE(SUM(expected_revenue), 0) as total_expected,
          COALESCE(AVG(kpi_percent), 0) as avg_kpi
        FROM sale_reports 
        WHERE DATE_FORMAT(report_month, '%Y-%m') = ? AND ec_id IN (?)
      `, [currentMonth, ecIds]);
      if (stats) saleStats = stats;
    } catch (e) { }

    // BXH EC theo doanh thu
    let ecRanking = [];
    try {
      const [rows] = await db.query(`
        SELECT sr.ec_id, u.full_name as ec_name, b.code as branch_code,
               sr.revenue, sr.kpi_percent, sr.checkin_count, sr.leads_converted,
               sr.deposit_total, sr.expected_revenue
        FROM sale_reports sr
        JOIN users u ON sr.ec_id = u.id
        LEFT JOIN user_branches ub ON u.id = ub.user_id
        LEFT JOIN branches b ON ub.branch_id = b.id
        WHERE DATE_FORMAT(sr.report_month, '%Y-%m') = ? AND sr.ec_id IN (?)
        ORDER BY sr.revenue DESC
      `, [currentMonth, ecIds]);
      ecRanking = rows;
    } catch (e) { }

    res.json({
      success: true,
      data: {
        myEcs,
        saleStats,
        ecRanking,
        currentMonth
      }
    });
  } catch (error) { next(error); }
};

// Dashboard OM - Quản lý lớp nhiều cơ sở
export const getOm = async (req, res, next) => {
  try {
    const branchId = getBranchFilter(req);
    const branchFilter = branchId ? ' AND c.branch_id = ?' : '';
    const params = branchId ? [branchId] : [];

    // Classes stats
    const [[classes]] = await db.query(`
      SELECT COUNT(*) as total, 
        SUM(c.status = 'active') as active
      FROM classes c WHERE 1=1${branchFilter}`, params);

    // Sessions today
    const [todaySessions] = await db.query(`
      SELECT s.id, s.session_number, s.start_time, s.end_time, s.attendance_submitted,
             c.class_name, c.id as class_id, t.full_name as teacher_name, b.code as branch_code,
             (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') as student_count
      FROM sessions s 
      JOIN classes c ON s.class_id = c.id 
      JOIN branches b ON c.branch_id = b.id
      LEFT JOIN users t ON c.teacher_id = t.id
      WHERE s.session_date = CURDATE()${branchFilter}
      ORDER BY b.code, s.start_time
    `, params);

    // Học viên sắp hết phí
    let expiringStudents = [];
    try {
      const [rows] = await db.query(`
        SELECT s.id, s.full_name, s.student_code, s.remaining_sessions, s.fee_status,
               b.code as branch_code,
               (SELECT c.class_name FROM class_students cs JOIN classes c ON cs.class_id = c.id 
                WHERE cs.student_id = s.id AND cs.status = 'active' LIMIT 1) as class_name
        FROM students s
        JOIN branches b ON s.branch_id = b.id
        WHERE s.fee_status IN ('expiring_soon', 'expired') AND s.status = 'active'
          ${branchId ? 'AND s.branch_id = ?' : ''}
        ORDER BY s.remaining_sessions ASC LIMIT 10
      `, branchId ? [branchId] : []);
      expiringStudents = rows;
    } catch (e) { }

    res.json({
      success: true,
      data: { classes, todaySessions, expiringStudents }
    });
  } catch (error) { next(error); }
};

// Dashboard CM - Quản lý 1 cơ sở
export const getCM = async (req, res, next) => {
  try {
    const branchId = getBranchFilter(req);
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Không xác định được cơ sở' });
    }

    // Stats
    const [[students]] = await db.query(`
      SELECT COUNT(*) as total, 
        SUM(status = 'active') as active,
        SUM(fee_status = 'expiring_soon') as expiring_soon,
        SUM(fee_status = 'expired') as expired
      FROM students WHERE branch_id = ?`, [branchId]);

    const [[classes]] = await db.query(`
      SELECT COUNT(*) as total, SUM(status = 'active') as active 
      FROM classes WHERE branch_id = ?`, [branchId]);

    const [[teachers]] = await db.query(`
      SELECT COUNT(DISTINCT u.id) as total 
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN user_branches ub ON u.id = ub.user_id
      WHERE r.name = 'TEACHER' AND ub.branch_id = ? AND u.is_active = 1`, [branchId]);

    // Today sessions
    const [todaySessions] = await db.query(`
      SELECT s.id, s.session_number, s.start_time, s.end_time, s.attendance_submitted,
             c.class_name, t.full_name as teacher_name
      FROM sessions s 
      JOIN classes c ON s.class_id = c.id
      LEFT JOIN users t ON c.teacher_id = t.id
      WHERE s.session_date = CURDATE() AND c.branch_id = ?
      ORDER BY s.start_time
    `, [branchId]);

    // Học viên sắp hết phí
    let expiringStudents = [];
    try {
      const [rows] = await db.query(`
        SELECT s.id, s.full_name, s.student_code, s.parent_phone, s.remaining_sessions, s.fee_status,
               (SELECT c.class_name FROM class_students cs JOIN classes c ON cs.class_id = c.id 
                WHERE cs.student_id = s.id AND cs.status = 'active' LIMIT 1) as class_name
        FROM students s
        WHERE s.fee_status IN ('expiring_soon', 'expired') AND s.status = 'active' AND s.branch_id = ?
        ORDER BY s.remaining_sessions ASC LIMIT 15
      `, [branchId]);
      expiringStudents = rows;
    } catch (e) { }

    // Pending students
    const [pendingStudents] = await db.query(`
      SELECT s.id, s.full_name, s.student_code, s.parent_phone, sub.name as subject_name
      FROM students s
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE s.status = 'pending' AND s.branch_id = ?
      ORDER BY s.created_at DESC LIMIT 10
    `, [branchId]);

    res.json({
      success: true,
      data: {
        students, classes, teachers: teachers.total,
        todaySessions, expiringStudents, pendingStudents
      }
    });
  } catch (error) { next(error); }
};

// Dashboard EC (Sale) - Cá nhân
export const getSale = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthStart = `${currentMonth}-01`;
    const nextMonthStart = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() + 1)).toISOString().slice(0, 10);

    // My stats - tất cả leads của EC
    const [[myStats]] = await db.query(`
      SELECT 
        COUNT(*) as total_leads,
        SUM(status = 'scheduled') as scheduled,
        SUM(status = 'attended') as attended,
        SUM(status = 'trial') as trial,
        SUM(status = 'converted') as converted,
        SUM(status = 'waiting') as waiting,
        SUM(scheduled_date = CURDATE()) as today
      FROM leads WHERE sale_id = ?
    `, [userId]);

    // Tính doanh thu từ TẤT CẢ leads converted của EC (không chỉ trong tháng)
    // Doanh thu = actual_revenue của các lead đã converted
    const [[revenueStats]] = await db.query(`
      SELECT 
        COUNT(*) as leads_converted,
        COALESCE(SUM(actual_revenue), 0) as revenue,
        COALESCE(SUM(deposit_amount), 0) as deposit_total,
        COALESCE(SUM(fee_total - actual_revenue), 0) as expected_revenue
      FROM leads 
      WHERE sale_id = ? 
        AND status = 'converted'
    `, [userId]);

    // Đếm leads đang xử lý
    const [[pendingStats]] = await db.query(`
      SELECT COUNT(*) as checkin_count
      FROM leads 
      WHERE sale_id = ? 
        AND status IN ('scheduled', 'attended', 'trial', 'waiting')
    `, [userId]);

    // My KPI target
    let myKpi = null;
    try {
      const [[kpi]] = await db.query(`
        SELECT * FROM ec_kpi_targets 
        WHERE ec_id = ? AND DATE_FORMAT(target_month, '%Y-%m') = ?
      `, [userId, currentMonth]);
      myKpi = kpi;
    } catch (e) { }

    // Build myReport from calculated stats
    const revenue = revenueStats?.revenue || 0;
    const myReport = {
      revenue: revenue,
      deposit_total: revenueStats?.deposit_total || 0,
      expected_revenue: revenueStats?.expected_revenue || 0, // Tiền còn thiếu từ leads converted
      checkin_count: pendingStats?.checkin_count || 0,
      leads_converted: revenueStats?.leads_converted || 0,
      kpi_percent: myKpi?.target_revenue > 0
        ? Math.round(revenue / myKpi.target_revenue * 100)
        : 0
    };

    // Today leads - CHỈ leads của EC này
    const [todayLeads] = await db.query(`
      SELECT l.id, l.code, l.student_name, l.customer_name, l.customer_phone, 
             l.scheduled_time, l.status, l.actual_revenue, l.fee_total,
             s.name as subject_name
      FROM leads l
      LEFT JOIN subjects s ON l.subject_id = s.id
      WHERE l.sale_id = ? AND l.scheduled_date = CURDATE()
      ORDER BY l.scheduled_time
    `, [userId]);

    // Converted leads trong tháng - CHỈ leads của EC này
    const [convertedLeads] = await db.query(`
      SELECT l.id, l.code, l.student_name, l.customer_phone, 
             l.actual_revenue, l.deposit_amount, l.fee_total,
             DATE_FORMAT(l.converted_at, '%d/%m') as converted_date
      FROM leads l
      WHERE l.sale_id = ? 
        AND l.status = 'converted'
        AND l.converted_at >= ? AND l.converted_at < ?
      ORDER BY l.converted_at DESC LIMIT 10
    `, [userId, monthStart, nextMonthStart]);

    // Waiting leads
    const [waitingLeads] = await db.query(`
      SELECT l.id, l.code, l.student_name, l.customer_phone, l.trial_sessions_attended
      FROM leads l
      WHERE l.sale_id = ? AND l.status = 'waiting'
      ORDER BY l.updated_at DESC LIMIT 10
    `, [userId]);

    // My ranking
    let myRanking = { rank_branch: 0, rank_all: 0 };
    try {
      const [[ranking]] = await db.query(`
        SELECT 
          (SELECT COUNT(DISTINCT l2.sale_id) + 1 
           FROM leads l2 
           WHERE l2.status = 'converted'
             AND l2.converted_at >= ? AND l2.converted_at < ?
             AND COALESCE((SELECT SUM(actual_revenue) FROM leads 
                          WHERE sale_id = l2.sale_id AND status = 'converted'
                          AND converted_at >= ? AND converted_at < ?), 0) > ?
          ) as rank_all
        FROM dual
      `, [monthStart, nextMonthStart, monthStart, nextMonthStart, revenue]);
      if (ranking) myRanking = ranking;
    } catch (e) { console.error('Ranking error:', e); }

    res.json({
      success: true,
      data: {
        myStats, myReport, myKpi, myRanking,
        todayLeads, convertedLeads, waitingLeads,
        currentMonth
      }
    });
  } catch (error) { next(error); }
};

// Dashboard Teacher
export const getTeacher = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // My classes
    const [myClasses] = await db.query(`
      SELECT c.id, c.class_name, c.schedule, c.status,
             s.name as subject_name, l.name as level_name,
             (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status = 'active') as student_count,
             b.code as branch_code
      FROM classes c
      JOIN branches b ON c.branch_id = b.id
      LEFT JOIN subjects s ON c.subject_id = s.id
      LEFT JOIN levels l ON c.level_id = l.id
      WHERE c.teacher_id = ? AND c.status = 'active'
      ORDER BY c.class_name
    `, [userId]);

    // Today sessions
    const [todaySessions] = await db.query(`
      SELECT s.id, s.session_number, s.start_time, s.end_time, s.attendance_submitted,
             c.id as class_id, c.class_name
      FROM sessions s
      JOIN classes c ON s.class_id = c.id
      WHERE c.teacher_id = ? AND s.session_date = CURDATE()
      ORDER BY s.start_time
    `, [userId]);

    // Upcoming sessions
    const [upcomingSessions] = await db.query(`
      SELECT s.id, s.session_number, s.session_date, s.start_time, s.end_time,
             c.id as class_id, c.class_name
      FROM sessions s
      JOIN classes c ON s.class_id = c.id
      WHERE c.teacher_id = ? AND s.session_date > CURDATE()
      ORDER BY s.session_date, s.start_time
      LIMIT 10
    `, [userId]);

    // Pending attendance
    const [pendingAttendance] = await db.query(`
      SELECT s.id, s.session_number, s.session_date, c.class_name
      FROM sessions s
      JOIN classes c ON s.class_id = c.id
      WHERE c.teacher_id = ? AND s.session_date <= CURDATE() AND s.attendance_submitted = 0
      ORDER BY s.session_date DESC
      LIMIT 5
    `, [userId]);

    res.json({
      success: true,
      data: {
        myClasses,
        todaySessions,
        upcomingSessions,
        pendingAttendance
      }
    });
  } catch (error) { next(error); }
};