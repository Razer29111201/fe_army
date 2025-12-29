import BaseModel from './BaseModel.js';

class SaleReportModel extends BaseModel {
  constructor() {
    super('sale_reports');
  }

  // Lấy báo cáo của EC theo tháng - REALTIME từ leads
  async getByEcAndMonth(ecId, month) {
    const [rows] = await this.db.query(`
      SELECT 
        u.id as ec_id,
        u.full_name as ec_name,
        ub.branch_id,
        b.name as branch_name, 
        b.code as branch_code,
        COALESCE(stats.checkin_count, 0) as checkin_count,
        COALESCE(stats.revenue, 0) as revenue,
        COALESCE(stats.deposit_total, 0) as deposit_total,
        COALESCE(stats.expected_revenue, 0) as expected_revenue,
        COALESCE(stats.leads_converted, 0) as leads_converted,
        COALESCE(kt.target_revenue, 0) as kpi_target,
        CASE WHEN kt.target_revenue > 0 
          THEN ROUND(COALESCE(stats.revenue, 0) / kt.target_revenue * 100)
          ELSE 0 
        END as kpi_percent
      FROM users u
      LEFT JOIN user_branches ub ON ub.user_id = u.id
      LEFT JOIN branches b ON ub.branch_id = b.id
      LEFT JOIN ec_kpi_targets kt ON kt.ec_id = u.id AND DATE_FORMAT(kt.target_month, '%Y-%m') = ?
      LEFT JOIN (
        SELECT 
          sale_id,
          SUM(CASE WHEN status IN ('attended', 'trial', 'converted') THEN 1 ELSE 0 END) as checkin_count,
          SUM(CASE WHEN status = 'converted' THEN actual_revenue ELSE 0 END) as revenue,
          SUM(CASE WHEN status = 'converted' THEN deposit_amount ELSE 0 END) as deposit_total,
          SUM(CASE WHEN status = 'converted' THEN (fee_total - actual_revenue) ELSE 0 END) as expected_revenue,
          SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as leads_converted
        FROM leads
        GROUP BY sale_id
      ) stats ON stats.sale_id = u.id
      WHERE u.id = ?
    `, [month, ecId]);
    return rows[0] || null;
  }

  // Lấy báo cáo tất cả EC theo tháng - REALTIME từ leads
  async getAllByMonth(month, branchId = null, hoecId = null) {
    let sql = `
      SELECT 
        u.id as ec_id,
        u.full_name as ec_name,
        ub.branch_id,
        b.name as branch_name, 
        b.code as branch_code,
        COALESCE(stats.checkin_count, 0) as checkin_count,
        COALESCE(stats.revenue, 0) as revenue,
        COALESCE(stats.deposit_total, 0) as deposit_total,
        COALESCE(stats.expected_revenue, 0) as expected_revenue,
        COALESCE(stats.leads_converted, 0) as leads_converted,
        COALESCE(kt.target_revenue, 0) as kpi_target,
        CASE WHEN kt.target_revenue > 0 
          THEN ROUND(COALESCE(stats.revenue, 0) / kt.target_revenue * 100)
          ELSE 0 
        END as kpi_percent
      FROM users u
      LEFT JOIN user_branches ub ON ub.user_id = u.id
      LEFT JOIN branches b ON ub.branch_id = b.id
      LEFT JOIN ec_kpi_targets kt ON kt.ec_id = u.id AND DATE_FORMAT(kt.target_month, '%Y-%m') = ?
      LEFT JOIN (
        SELECT 
          sale_id,
          SUM(CASE WHEN status IN ('attended', 'trial', 'converted') THEN 1 ELSE 0 END) as checkin_count,
          SUM(CASE WHEN status = 'converted' THEN actual_revenue ELSE 0 END) as revenue,
          SUM(CASE WHEN status = 'converted' THEN deposit_amount ELSE 0 END) as deposit_total,
          SUM(CASE WHEN status = 'converted' THEN (fee_total - actual_revenue) ELSE 0 END) as expected_revenue,
          SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as leads_converted
        FROM leads
        GROUP BY sale_id
      ) stats ON stats.sale_id = u.id
      WHERE u.role_id IN (SELECT id FROM roles WHERE name IN ('EC', 'SALE'))
    `;
    const params = [month];

    if (branchId) {
      sql += ' AND ub.branch_id = ?';
      params.push(branchId);
    }

    sql += ' ORDER BY revenue DESC';
    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  // Tổng hợp báo cáo theo tháng - REALTIME từ leads
  async getSummaryByMonth(month, branchId = null) {
    let sql = `
      SELECT 
        COUNT(DISTINCT l.sale_id) as total_ec,
        SUM(CASE WHEN l.status IN ('attended', 'trial', 'converted') THEN 1 ELSE 0 END) as total_checkin,
        SUM(CASE WHEN l.status = 'converted' THEN l.actual_revenue ELSE 0 END) as total_revenue,
        SUM(CASE WHEN l.status = 'converted' THEN l.deposit_amount ELSE 0 END) as total_deposit,
        SUM(CASE WHEN l.status = 'converted' THEN (l.fee_total - l.actual_revenue) ELSE 0 END) as total_expected,
        SUM(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) as total_converted
      FROM leads l
      WHERE 1=1
    `;
    const params = [];

    if (branchId) {
      sql += ' AND l.branch_id = ?';
      params.push(branchId);
    }

    const [rows] = await this.db.query(sql, params);
    return rows[0];
  }

  // Bảng xếp hạng theo doanh thu - REALTIME từ leads
  async getRankingByRevenue(month, branchId = null, limit = 10) {
    let sql = `
      SELECT 
        u.id as ec_id,
        u.full_name as ec_name,
        b.name as branch_name, 
        b.code as branch_code,
        COALESCE(stats.revenue, 0) as revenue,
        COALESCE(stats.checkin_count, 0) as checkin_count,
        COALESCE(stats.leads_converted, 0) as leads_converted,
        COALESCE(stats.deposit_total, 0) as deposit_total,
        COALESCE(stats.expected_revenue, 0) as expected_revenue,
        COALESCE(kt.target_revenue, 0) as kpi_target,
        CASE WHEN kt.target_revenue > 0 
          THEN ROUND(COALESCE(stats.revenue, 0) / kt.target_revenue * 100)
          ELSE 0 
        END as kpi_percent
      FROM users u
      LEFT JOIN user_branches ub ON ub.user_id = u.id
      LEFT JOIN branches b ON ub.branch_id = b.id
      LEFT JOIN ec_kpi_targets kt ON kt.ec_id = u.id AND DATE_FORMAT(kt.target_month, '%Y-%m') = ?
      LEFT JOIN (
        SELECT 
          sale_id,
          SUM(CASE WHEN status IN ('attended', 'trial', 'converted') THEN 1 ELSE 0 END) as checkin_count,
          SUM(CASE WHEN status = 'converted' THEN actual_revenue ELSE 0 END) as revenue,
          SUM(CASE WHEN status = 'converted' THEN deposit_amount ELSE 0 END) as deposit_total,
          SUM(CASE WHEN status = 'converted' THEN (fee_total - actual_revenue) ELSE 0 END) as expected_revenue,
          SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as leads_converted
        FROM leads
        GROUP BY sale_id
      ) stats ON stats.sale_id = u.id
      WHERE u.role_id IN (SELECT id FROM roles WHERE name IN ('EC', 'SALE'))
        AND COALESCE(stats.revenue, 0) > 0
    `;
    const params = [month];

    if (branchId) {
      sql += ' AND ub.branch_id = ?';
      params.push(branchId);
    }

    sql += ' ORDER BY revenue DESC LIMIT ?';
    params.push(limit);

    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  // Bảng xếp hạng theo KPI % - REALTIME từ leads
  async getRankingByKpi(month, branchId = null, limit = 10) {
    let sql = `
      SELECT 
        u.id as ec_id,
        u.full_name as ec_name,
        b.name as branch_name, 
        b.code as branch_code,
        COALESCE(stats.revenue, 0) as revenue,
        COALESCE(kt.target_revenue, 0) as kpi_target,
        CASE WHEN kt.target_revenue > 0 
          THEN ROUND(COALESCE(stats.revenue, 0) / kt.target_revenue * 100)
          ELSE 0 
        END as kpi_percent,
        COALESCE(stats.checkin_count, 0) as checkin_count
      FROM users u
      LEFT JOIN user_branches ub ON ub.user_id = u.id
      LEFT JOIN branches b ON ub.branch_id = b.id
      INNER JOIN ec_kpi_targets kt ON kt.ec_id = u.id AND DATE_FORMAT(kt.target_month, '%Y-%m') = ?
      LEFT JOIN (
        SELECT 
          sale_id,
          SUM(CASE WHEN status IN ('attended', 'trial', 'converted') THEN 1 ELSE 0 END) as checkin_count,
          SUM(CASE WHEN status = 'converted' THEN actual_revenue ELSE 0 END) as revenue
        FROM leads
        GROUP BY sale_id
      ) stats ON stats.sale_id = u.id
      WHERE u.role_id IN (SELECT id FROM roles WHERE name IN ('EC', 'SALE'))
        AND kt.target_revenue > 0
    `;
    const params = [month];

    if (branchId) {
      sql += ' AND ub.branch_id = ?';
      params.push(branchId);
    }

    sql += ' ORDER BY kpi_percent DESC LIMIT ?';
    params.push(limit);

    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  // Báo cáo theo cơ sở - REALTIME từ leads
  async getByBranch(month, branchId = null) {
    let sql = `
      SELECT 
        b.id as branch_id,
        b.name as branch_name,
        b.code as branch_code,
        COUNT(DISTINCT l.sale_id) as total_ec,
        SUM(CASE WHEN l.status IN ('attended', 'trial', 'converted') THEN 1 ELSE 0 END) as checkin_count,
        SUM(CASE WHEN l.status = 'converted' THEN l.actual_revenue ELSE 0 END) as revenue,
        SUM(CASE WHEN l.status = 'converted' THEN l.deposit_amount ELSE 0 END) as deposit_total,
        SUM(CASE WHEN l.status = 'converted' THEN (l.fee_total - l.actual_revenue) ELSE 0 END) as expected_revenue,
        SUM(CASE WHEN l.status = 'converted' THEN 1 ELSE 0 END) as leads_converted
      FROM branches b
      LEFT JOIN leads l ON l.branch_id = b.id
      WHERE b.status = 'active'
    `;
    const params = [];

    if (branchId) {
      sql += ' AND b.id = ?';
      params.push(branchId);
    }

    sql += ' GROUP BY b.id ORDER BY revenue DESC';
    const [rows] = await this.db.query(sql, params);
    return rows;
  }
}

export default new SaleReportModel();