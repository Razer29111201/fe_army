import LeadModel from '../models/LeadModel.js';
import StudentModel from '../models/StudentModel.js';
import telegramService from '../services/telegramService.js';
import { getBranchFilter, getCreateBranchId, getBranchCode } from '../utils/branchHelper.js';

// Helper to get sale filter based on role
function getSaleFilter(req) {
  // EC và SALE chỉ thấy leads của mình
  // HOEC, OM, ADMIN thấy tất cả (trong branch của họ)
  const role = req.user.role_name;
  if (role === 'EC' || role === 'SALE') {
    return req.user.id;
  }
  return null; // Không filter theo sale_id
}

// Lấy danh sách leads
export const getAll = async (req, res, next) => {
  try {
    const { status, fromDate, toDate, search, source, page = 1, limit = 20 } = req.query;
    const saleId = getSaleFilter(req);
    const branchId = getBranchFilter(req);

    const result = await LeadModel.findAllWithRelations({
      status, fromDate, toDate, search, source, saleId, branchId, page, limit
    });
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
};

// Thống kê
export const getStats = async (req, res, next) => {
  try {
    const saleId = getSaleFilter(req);
    const branchId = getBranchFilter(req);
    const stats = await LeadModel.getStats(saleId, branchId);
    res.json({ success: true, data: stats });
  } catch (error) { next(error); }
};

// Lấy chi tiết
export const getById = async (req, res, next) => {
  try {
    const lead = await LeadModel.findByIdWithRelations(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, data: lead });
  } catch (error) { next(error); }
};

// Lấy theo tháng (calendar)
export const getByMonth = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    const saleId = getSaleFilter(req);
    const branchId = getBranchFilter(req);
    const data = await LeadModel.getByMonth(year, month, saleId, branchId);
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

// Tạo mới (hỗ trợ nhiều học sinh)
export const create = async (req, res, next) => {
  try {
    const {
      customerName, customerPhone, customerEmail,
      students, // Array of {name, birthYear}
      studentName, studentBirthYear, // Legacy single student
      subjectId, levelId,
      scheduledDate, scheduledTime,
      source, note,
      expectedRevenue, // Dự kiến học phí
      saleId // Giao cho EC cụ thể (cho Manager)
    } = req.body;

    // Validation
    if (!customerName || !customerPhone) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin phụ huynh' });
    }

    // Check duplicate phone - cho phép trùng nếu lead cũ bị cancelled/lỗi
    const existingLead = await LeadModel.findByPhone(customerPhone);
    if (existingLead && existingLead.status !== 'cancelled') {
      return res.status(400).json({
        success: false,
        message: `SĐT đã tồn tại: ${existingLead.customer_name} - ${existingLead.student_name} (${existingLead.code})`,
        data: existingLead
      });
    }

    const finalBranchId = getCreateBranchId(req);
    if (!finalBranchId) {
      return res.status(400).json({ success: false, message: 'Cần chọn cơ sở' });
    }

    const branchCode = getBranchCode(req.user, finalBranchId);

    // Xác định status ban đầu
    let status = 'new';
    if (scheduledDate && scheduledTime) {
      status = 'scheduled';
    }

    // Xử lý danh sách học sinh
    let studentList = [];
    if (students && Array.isArray(students) && students.length > 0) {
      studentList = students.filter(s => s.name?.trim());
    } else if (studentName) {
      // Legacy: single student
      studentList = [{ name: studentName, birthYear: studentBirthYear }];
    }

    if (studentList.length === 0) {
      return res.status(400).json({ success: false, message: 'Cần nhập ít nhất 1 học sinh' });
    }

    // Tạo lead cho mỗi học sinh
    const createdLeads = [];
    // Nếu Manager giao cho EC cụ thể, dùng saleId đó, ngược lại dùng user hiện tại
    const assignedSaleId = saleId || req.user.id;

    for (let i = 0; i < studentList.length; i++) {
      const student = studentList[i];
      const code = await LeadModel.generateCode(branchCode);

      const lead = await LeadModel.create({
        branch_id: finalBranchId,
        code,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        student_name: student.name,
        student_birth_year: student.birthYear || null,
        subject_id: subjectId || null,
        level_id: levelId || null,
        scheduled_date: scheduledDate || null,
        scheduled_time: scheduledTime || null,
        status,
        source: source || null,
        expected_revenue: expectedRevenue || 0,
        note: studentList.length > 1 ? `${note || ''} [Anh/chị em: ${studentList.length} HS]`.trim() : note,
        sale_id: assignedSaleId
      });

      createdLeads.push(lead);
    }

    // Gửi thông báo Telegram
    try {
      const studentNames = studentList.map(s => s.name).join(', ');
      await telegramService.sendMessage(
        `🎯 <b>Lead mới!</b>\n` +
        `📋 Mã: ${createdLeads[0].code}${createdLeads.length > 1 ? ` (+${createdLeads.length - 1})` : ''}\n` +
        `👤 KH: ${customerName}\n` +
        `📱 SĐT: ${customerPhone}\n` +
        `👶 HS: ${studentNames}\n` +
        `📅 Lịch: ${scheduledDate ? `${scheduledDate} ${scheduledTime || ''}` : 'Chưa đặt lịch'}\n` +
        `👨‍💼 Sale: ${req.user.full_name}`
      );
    } catch (e) { console.error('Telegram error:', e); }

    res.status(201).json({
      success: true,
      message: `Tạo ${createdLeads.length} lead thành công`,
      data: createdLeads.length === 1 ? createdLeads[0] : createdLeads
    });
  } catch (error) { next(error); }
};

// Cập nhật
export const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      customerName, customerPhone, customerEmail,
      studentName, studentBirthYear,
      subjectId, levelId,
      scheduledDate, scheduledTime,
      status, source, note, rating, feedback,
      trialClassId, trialSessionsMax,
      expectedRevenue, // Dự kiến học phí
      actual_revenue, deposit_amount, fee_total // Thêm các field thanh toán
    } = req.body;

    const data = {};
    if (customerName) data.customer_name = customerName;
    if (customerPhone) data.customer_phone = customerPhone;
    if (customerEmail !== undefined) data.customer_email = customerEmail;
    if (studentName) data.student_name = studentName;
    if (studentBirthYear) data.student_birth_year = studentBirthYear;
    if (subjectId !== undefined) data.subject_id = subjectId || null;
    if (levelId !== undefined) data.level_id = levelId || null;
    if (scheduledDate !== undefined) data.scheduled_date = scheduledDate || null;
    if (scheduledTime !== undefined) data.scheduled_time = scheduledTime || null;
    if (status) data.status = status;
    if (source !== undefined) data.source = source;
    if (note !== undefined) data.note = note;
    if (rating !== undefined) data.rating = rating;
    if (feedback !== undefined) data.feedback = feedback;
    if (trialClassId !== undefined) data.trial_class_id = trialClassId || null;
    if (trialSessionsMax !== undefined) data.trial_sessions_max = trialSessionsMax;

    // Dự kiến học phí
    if (expectedRevenue !== undefined) data.expected_revenue = expectedRevenue;

    // Các field thanh toán
    if (actual_revenue !== undefined) data.actual_revenue = actual_revenue;
    if (deposit_amount !== undefined) data.deposit_amount = deposit_amount;
    if (fee_total !== undefined) data.fee_total = fee_total;

    await LeadModel.update(id, data);
    res.json({ success: true, message: 'Cập nhật thành công' });
  } catch (error) { next(error); }
};

// Xóa
export const remove = async (req, res, next) => {
  try {
    await LeadModel.delete(req.params.id);
    res.json({ success: true, message: 'Đã xóa' });
  } catch (error) { next(error); }
};

// Đánh dấu đã đến trải nghiệm / học thử
export const markAttended = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating, feedback } = req.body;

    const lead = await LeadModel.findByIdWithRelations(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    }

    // Nếu đang ở trạng thái trial, tăng số buổi đã học
    if (lead.status === 'trial') {
      await LeadModel.incrementTrialSessions(id);
    }

    // Cập nhật rating và feedback
    const updateData = {};
    if (rating) updateData.rating = rating;
    if (feedback) updateData.feedback = feedback;

    // Nếu chưa phải trial, chuyển sang attended
    if (lead.status === 'scheduled' || lead.status === 'new') {
      updateData.status = 'attended';
    }

    if (Object.keys(updateData).length > 0) {
      await LeadModel.update(id, updateData);
    }

    res.json({ success: true, message: 'Đã điểm danh thành công' });
  } catch (error) { next(error); }
};

// Đánh dấu không đến
export const markNoShow = async (req, res, next) => {
  try {
    await LeadModel.updateStatus(req.params.id, 'no_show');
    res.json({ success: true, message: 'Đã đánh dấu không đến' });
  } catch (error) { next(error); }
};

// Gán lớp học thử
// Đặt lịch trải nghiệm (chỉ cần ngày, giờ, bộ môn)
export const assignTrialClass = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledDate, scheduledTime, subjectId, note } = req.body;

    if (!scheduledDate || !scheduledTime) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ngày và giờ' });
    }

    const data = {
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      status: 'scheduled'
    };

    if (subjectId) data.subject_id = subjectId;
    if (note) data.note = note;

    await LeadModel.update(id, data);

    // Gửi thông báo
    const lead = await LeadModel.findByIdWithRelations(id);
    try {
      await telegramService.sendMessage(
        `📅 <b>Đặt lịch trải nghiệm!</b>\n` +
        `👶 HS: ${lead.student_name}\n` +
        `👤 PH: ${lead.customer_name} - ${lead.customer_phone}\n` +
        `📆 Ngày: ${scheduledDate}\n` +
        `⏰ Giờ: ${scheduledTime}\n` +
        (lead.subject_name ? `📚 Môn: ${lead.subject_name}` : '')
      );
    } catch (e) { console.error('Telegram error:', e); }

    res.json({ success: true, message: 'Đã đặt lịch trải nghiệm' });
  } catch (error) { next(error); }
};

// Hoàn thành 1 buổi học thử
export const completeSession = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sessionNum } = req.body;

    const lead = await LeadModel.findByIdWithRelations(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    }

    // Tăng số buổi đã học
    await LeadModel.incrementTrialSessions(id);
    const newSessionsAttended = (lead.trial_sessions_attended || 0) + 1;

    // Cập nhật status
    // Buổi 1 hoàn thành -> waiting (chờ quyết định: đặt B2 hoặc chuyển đổi)
    // Buổi 2, 3 hoàn thành -> vẫn waiting
    let newStatus = 'waiting';

    if (newSessionsAttended >= (lead.trial_sessions_max || 3)) {
      // Đã học đủ số buổi max -> chờ chuyển đổi
      newStatus = 'waiting';
    }

    await LeadModel.update(id, { status: newStatus });

    // Gửi thông báo Telegram
    try {
      await telegramService.sendMessage(
        `✅ <b>Hoàn thành buổi ${sessionNum}!</b>\n` +
        `👶 HS: ${lead.student_name}\n` +
        `📊 Tiến độ: ${newSessionsAttended}/${lead.trial_sessions_max || 3} buổi\n` +
        `⏳ Trạng thái: Chờ đặt lịch tiếp hoặc chuyển đổi`
      );
    } catch (e) { console.error('Telegram error:', e); }

    res.json({ success: true, message: `Đã hoàn thành buổi ${sessionNum}. Chờ đặt lịch tiếp hoặc chuyển đổi.` });
  } catch (error) { next(error); }
};

// Chuyển đổi thành học sinh chính thức (Full data)
export const convertToStudent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      studentName, birthYear, gender, school,
      parentName, parentPhone, parentEmail, address,
      subjectId, levelId, sessionsPerWeek, startDate,
      classId, // Thêm classId để xếp lớp luôn nếu có
      feePackage, feeOriginal, feeDiscount, feeTotal,
      paymentStatus, depositAmount, paidAmount, note
    } = req.body;

    const lead = await LeadModel.findByIdWithRelations(id);
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy lead' });
    }

    // Tạo học sinh mới với status = pending (chờ CM xếp lớp) hoặc active nếu có classId
    const studentCode = await StudentModel.generateCode(lead.branch_code);

    const studentData = {
      branch_id: lead.branch_id,
      student_code: studentCode,
      full_name: studentName || lead.student_name,
      birth_year: birthYear || lead.student_birth_year,
      gender: gender || null,
      school: school || null,
      parent_name: parentName || lead.customer_name,
      parent_phone: parentPhone || lead.customer_phone,
      parent_email: parentEmail || lead.customer_email,
      address: address || null,
      subject_id: subjectId || lead.subject_id,
      level_id: levelId || lead.level_id,
      sessions_per_week: sessionsPerWeek || 2,
      start_date: startDate || null,
      fee_package: feePackage || 'monthly',
      fee_original: feeOriginal || 0,
      fee_discount: feeDiscount || 0,
      fee_total: feeTotal || 0,
      payment_status: paymentStatus || 'pending',
      paid_amount: paidAmount || 0,
      note: note || null,
      status: classId ? 'active' : 'pending' // Active nếu có lớp, pending nếu chờ xếp
    };

    // Add optional columns if they exist in DB
    // class_id và ec_id cần chạy migration trước
    // studentData.class_id = classId || null;
    // studentData.ec_id = lead.sale_id;

    const student = await StudentModel.create(studentData);

    // Tính actual_revenue = cọc + đã đóng
    const actualRevenue = (depositAmount || 0) + (paidAmount || 0);

    // Cập nhật lead với actual_revenue, deposit_amount và fee_total
    await LeadModel.convertToStudent(id, student.id, actualRevenue, depositAmount || 0, feeTotal || 0);

    // Gửi thông báo Telegram cho CM
    try {
      const paymentInfo = paymentStatus === 'paid' ? 'Đã đóng đủ' :
        paymentStatus === 'deposit' ? `Cọc ${(depositAmount || 0).toLocaleString('vi-VN')}đ` :
          paymentStatus === 'partial' ? `Đã đóng ${actualRevenue.toLocaleString('vi-VN')}đ` : 'Chưa đóng';
      await telegramService.sendMessage(
        `🎉 <b>Học viên mới${classId ? '' : ' chờ xếp lớp'}!</b>\n` +
        `👶 HS: ${studentName || lead.student_name}\n` +
        `📋 Mã: ${studentCode}\n` +
        `👤 PH: ${parentName || lead.customer_name} - ${parentPhone || lead.customer_phone}\n` +
        `📚 Môn: ${lead.subject_name || '-'}\n` +
        `💰 Học phí: ${(feeTotal || 0).toLocaleString('vi-VN')}đ (${paymentInfo})\n` +
        `👨‍💼 EC: ${lead.sale_name || '-'}\n` +
        (classId ? '' : `⏰ CM vui lòng xếp lớp!`)
      );
    } catch (e) { console.error('Telegram error:', e); }

    res.json({
      success: true,
      message: classId ? 'Đã chuyển đổi và xếp lớp thành công!' : 'Đã chuyển đổi thành học sinh. CM sẽ xếp lớp sau.',
      data: { studentId: student.id, studentCode }
    });
  } catch (error) { next(error); }
};

// Check duplicate phone
export const checkPhone = async (req, res, next) => {
  try {
    const { phone } = req.query;
    const branchId = getBranchFilter(req);
    const existing = await LeadModel.findByPhone(phone, branchId);

    res.json({
      success: true,
      exists: !!existing,
      data: existing ? {
        id: existing.id,
        code: existing.code,
        customerName: existing.customer_name,
        studentName: existing.student_name,
        status: existing.status
      } : null
    });
  } catch (error) { next(error); }
};

// ============ CALL LOGS ============

// Add call log
export const addCallLog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { duration, result, note, called_at } = req.body;

    await LeadModel.addCallLog({
      lead_id: id,
      user_id: req.user.id,
      duration: duration || 0,
      result: result || null,
      note: note || null,
      called_at: called_at || new Date()
    });

    res.json({ success: true, message: 'Đã lưu ghi chú cuộc gọi' });
  } catch (error) { next(error); }
};

// Get call logs
export const getCallLogs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const logs = await LeadModel.getCallLogs(id);
    res.json({ success: true, data: logs });
  } catch (error) { next(error); }
};