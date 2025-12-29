import BaseModel from './BaseModel.js';

class LeadModel extends BaseModel {
  constructor() {
    super('leads');
  }

  // Tạo mã lead tự động
  async generateCode(branchCode) {
    const prefix = branchCode || 'LD';
    const [rows] = await this.db.query(
      `SELECT code FROM leads WHERE code LIKE ? ORDER BY id DESC LIMIT 1`,
      [`${prefix}-%`]
    );

    let nextNum = 1;
    if (rows.length > 0) {
      const lastCode = rows[0].code;
      const match = lastCode.match(/(\d+)$/);
      if (match) nextNum = parseInt(match[1]) + 1;
    }

    return `${prefix}-${String(nextNum).padStart(5, '0')}`;
  }

  // Lấy tất cả leads với filter
  async findAllWithRelations({ status, fromDate, toDate, search, saleId, branchId, source, page = 1, limit = 20 } = {}) {
    let sql = `
      SELECT l.id, l.branch_id, l.code, l.customer_name, l.customer_phone, l.customer_email,
             l.student_name, l.student_birth_year, l.subject_id, l.level_id,
             DATE_FORMAT(l.scheduled_date, '%Y-%m-%d') as scheduled_date,
             l.scheduled_time, l.status, l.trial_class_id, l.trial_sessions_max,
             l.trial_sessions_attended, l.converted_student_id, l.rating, l.feedback, 
             l.note, l.source, l.sale_id, l.created_at, l.updated_at,
             l.actual_revenue, l.deposit_amount, l.fee_total,
             b.name as branch_name, b.code as branch_code,
             s.name as subject_name, 
             lv.name as level_name,
             c.class_name as trial_class_name,
             u.full_name as sale_name,
             st.full_name as converted_student_name
      FROM leads l
      LEFT JOIN branches b ON l.branch_id = b.id
      LEFT JOIN subjects s ON l.subject_id = s.id
      LEFT JOIN levels lv ON l.level_id = lv.id
      LEFT JOIN classes c ON l.trial_class_id = c.id
      LEFT JOIN users u ON l.sale_id = u.id
      LEFT JOIN students st ON l.converted_student_id = st.id
      WHERE 1=1
    `;
    const params = [];

    if (branchId) {
      sql += ' AND l.branch_id = ?';
      params.push(branchId);
    }
    if (status) {
      sql += ' AND l.status = ?';
      params.push(status);
    }
    if (source) {
      sql += ' AND l.source = ?';
      params.push(source);
    }
    if (fromDate) {
      sql += ' AND l.scheduled_date >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      sql += ' AND l.scheduled_date <= ?';
      params.push(toDate);
    }
    if (search) {
      sql += ' AND (l.customer_name LIKE ? OR l.student_name LIKE ? OR l.customer_phone LIKE ? OR l.code LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (saleId) {
      sql += ' AND l.sale_id = ?';
      params.push(saleId);
    }

    // Count
    const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as total FROM');
    const [countRows] = await this.db.query(countSql, params);
    const total = countRows[0]?.total || 0;

    // Pagination
    sql += ' ORDER BY l.scheduled_date DESC, l.scheduled_time DESC, l.created_at DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(+limit, (+page - 1) * +limit);

    const [rows] = await this.db.query(sql, params);
    return { data: rows, pagination: { page: +page, limit: +limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // Lấy leads theo tháng (cho calendar) - bao gồm cả status waiting
  async getByMonth(year, month, saleId = null, branchId = null) {
    let sql = `
      SELECT l.id, l.branch_id, l.code, l.customer_name, l.customer_phone, l.customer_email,
             l.student_name, l.student_birth_year, l.subject_id, l.level_id,
             DATE_FORMAT(l.scheduled_date, '%Y-%m-%d') as scheduled_date,
             l.scheduled_time, l.status, l.trial_class_id, l.trial_sessions_max,
             l.trial_sessions_attended, l.rating, l.feedback, l.note, l.source, l.sale_id,
             b.code as branch_code,
             s.name as subject_name
      FROM leads l
      LEFT JOIN branches b ON l.branch_id = b.id
      LEFT JOIN subjects s ON l.subject_id = s.id
      WHERE (
        (YEAR(l.scheduled_date) = ? AND MONTH(l.scheduled_date) = ? AND l.status IN ('scheduled', 'trial'))
        OR (l.status = 'waiting' AND YEAR(l.updated_at) = ? AND MONTH(l.updated_at) = ?)
      )
    `;
    const params = [year, month, year, month];

    if (branchId) {
      sql += ' AND l.branch_id = ?';
      params.push(branchId);
    }
    if (saleId) {
      sql += ' AND l.sale_id = ?';
      params.push(saleId);
    }

    sql += ' ORDER BY l.scheduled_date, l.scheduled_time';
    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  // Lấy chi tiết lead
  async findByIdWithRelations(id) {
    const [rows] = await this.db.query(`
      SELECT l.*, 
             DATE_FORMAT(l.scheduled_date, '%Y-%m-%d') as scheduled_date,
             b.name as branch_name, b.code as branch_code,
             s.name as subject_name, 
             lv.name as level_name,
             c.id as trial_class_id, c.class_name as trial_class_name,
             u.full_name as sale_name,
             st.id as converted_student_id, st.full_name as converted_student_name
      FROM leads l
      LEFT JOIN branches b ON l.branch_id = b.id
      LEFT JOIN subjects s ON l.subject_id = s.id
      LEFT JOIN levels lv ON l.level_id = lv.id
      LEFT JOIN classes c ON l.trial_class_id = c.id
      LEFT JOIN users u ON l.sale_id = u.id
      LEFT JOIN students st ON l.converted_student_id = st.id
      WHERE l.id = ?
    `, [id]);
    return rows[0] || null;
  }

  // Thống kê
  async getStats(saleId = null, branchId = null) {
    let whereClause = '1=1';
    const params = [];

    if (branchId) {
      whereClause += ' AND branch_id = ?';
      params.push(branchId);
    }
    if (saleId) {
      whereClause += ' AND sale_id = ?';
      params.push(saleId);
    }

    const [rows] = await this.db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(status = 'new') as \`new\`,
        SUM(status = 'scheduled') as scheduled,
        SUM(status = 'attended') as attended,
        SUM(status = 'waiting') as waiting,
        SUM(status = 'trial') as trial,
        SUM(status = 'converted') as converted,
        SUM(status = 'cancelled') as cancelled,
        SUM(status = 'no_show') as no_show,
        SUM(scheduled_date = CURDATE() AND status IN ('scheduled', 'trial')) as today,
        SUM(scheduled_date = CURDATE() + INTERVAL 1 DAY AND status = 'scheduled') as tomorrow,
        SUM(status = 'waiting') as pending_action
      FROM leads WHERE ${whereClause}
    `, params);

    return rows[0];
  }

  // Cập nhật trạng thái
  async updateStatus(id, status, extraData = {}) {
    const data = { status, ...extraData };

    if (status === 'converted' && !extraData.converted_at) {
      data.converted_at = new Date();
    }

    return this.update(id, data);
  }

  // Gán lớp học thử
  async assignTrialClass(id, classId) {
    return this.update(id, {
      trial_class_id: classId,
      status: 'trial'
    });
  }

  // Tăng số buổi đã học thử
  async incrementTrialSessions(id) {
    await this.db.query(
      'UPDATE leads SET trial_sessions_attended = trial_sessions_attended + 1 WHERE id = ?',
      [id]
    );
  }

  // Chuyển đổi thành học sinh chính thức
  async convertToStudent(id, studentId, actualRevenue = 0, depositAmount = 0, feeTotal = 0) {
    return this.update(id, {
      status: 'converted',
      converted_student_id: studentId,
      converted_at: new Date(),
      actual_revenue: actualRevenue,
      deposit_amount: depositAmount,
      fee_total: feeTotal
    });
  }

  // Tìm theo số điện thoại (check duplicate)
  async findByPhone(phone, branchId = null) {
    let sql = 'SELECT * FROM leads WHERE customer_phone = ?';
    const params = [phone];

    if (branchId) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';
    const [rows] = await this.db.query(sql, params);
    return rows[0] || null;
  }

  // ============ CALL LOGS ============

  // Add call log
  async addCallLog(data) {
    const sql = `INSERT INTO lead_call_logs (lead_id, user_id, duration, result, note, called_at, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`;
    const [result] = await this.db.query(sql, [
      data.lead_id,
      data.user_id,
      data.duration || 0,
      data.result || null,
      data.note || null,
      data.called_at || new Date()
    ]);
    return result.insertId;
  }

  // Get call logs for a lead
  async getCallLogs(leadId) {
    const sql = `SELECT cl.*, u.full_name as caller_name 
                 FROM lead_call_logs cl
                 LEFT JOIN users u ON cl.user_id = u.id
                 WHERE cl.lead_id = ?
                 ORDER BY cl.called_at DESC
                 LIMIT 50`;
    const [rows] = await this.db.query(sql, [leadId]);
    return rows;
  }
}

export default new LeadModel();