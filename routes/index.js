import { Router } from 'express';
import { authenticate, authorize, authorizeRole } from '../middleware/auth.js';
import { upload } from '../config/cloudinary.js';

// Controllers
import * as auth from '../controllers/authController.js';
import * as user from '../controllers/userController.js';
import * as branch from '../controllers/branchController.js';
import * as student from '../controllers/studentController.js';
import * as cls from '../controllers/classController.js';
import * as experience from '../controllers/experienceController.js';
import * as trial from '../controllers/trialController.js';
import * as lead from '../controllers/leadController.js';
import * as session from '../controllers/sessionController.js';
import * as attendance from '../controllers/attendanceController.js';
import * as assignment from '../controllers/assignmentController.js';
import * as file from '../controllers/fileController.js';
import * as common from '../controllers/commonController.js';
import * as dashboard from '../controllers/dashboardController.js';

const router = Router();

// AUTH
router.post('/auth/login', auth.login);
router.get('/auth/me', authenticate, auth.me);
router.put('/auth/password', authenticate, auth.changePassword);
router.put('/auth/profile', authenticate, auth.updateProfile);

// BRANCHES
router.get('/branches', authenticate, branch.getAll);
router.get('/branches/stats', authenticate, branch.getStats);
router.get('/branches/user/:userId', authenticate, branch.getUserBranches);
router.get('/branches/:id', authenticate, branch.getById);
router.post('/branches', authenticate, authorizeRole('ADMIN'), branch.create);
router.put('/branches/:id', authenticate, authorizeRole('ADMIN'), branch.update);
router.delete('/branches/:id', authenticate, authorizeRole('ADMIN'), branch.remove);
router.put('/branches/user/:userId', authenticate, authorizeRole('ADMIN'), branch.setUserBranches);

// USERS
router.get('/users', authenticate, authorize('user.view'), user.getAll);
router.get('/users/roles', authenticate, user.getRoles);
router.get('/users/by-role/:role', authenticate, user.getByRole);
router.get('/users/:id', authenticate, authorize('user.view'), user.getById);
router.post('/users', authenticate, authorize('user.create'), user.create);
router.put('/users/:id', authenticate, authorize('user.edit'), user.update);
router.put('/users/:id/reset-password', authenticate, authorize('user.edit'), user.resetPassword);
router.delete('/users/:id', authenticate, authorize('user.delete'), user.remove);

// STUDENTS
router.get('/students', authenticate, authorize('student.view'), student.getAll);
router.get('/students/stats', authenticate, authorize('student.view'), student.getStats);
router.get('/students/:id', authenticate, authorize('student.view'), student.getById);
router.post('/students', authenticate, authorizeRole('SALE', 'ADMIN'), student.create);
router.put('/students/:id', authenticate, authorizeRole('SALE', 'ADMIN'), student.update);
router.delete('/students/:id', authenticate, authorizeRole('SALE', 'ADMIN'), student.remove);

// CLASSES
// CLASSES
const classViewRoles = ['EC', 'SALE', 'HOEC', 'OM', 'CM', 'TEACHER', 'ADMIN'];
router.get('/classes', authenticate, authorizeRole(...classViewRoles), cls.getAll);
router.get('/classes/stats', authenticate, cls.getStats);
router.get('/classes/:id', authenticate, authorizeRole(...classViewRoles), cls.getById);
router.get('/classes/:id/students', authenticate, authorizeRole(...classViewRoles), cls.getStudents);
router.post('/classes', authenticate, authorizeRole('CM', 'ADMIN'), cls.create);
router.put('/classes/:id', authenticate, authorizeRole('CM', 'ADMIN'), cls.update);
router.delete('/classes/:id', authenticate, authorizeRole('ADMIN'), cls.remove);
router.post('/classes/:id/students', authenticate, authorizeRole('CM', 'ADMIN'), cls.addStudent);
router.delete('/classes/:id/students/:studentId', authenticate, authorizeRole('CM', 'ADMIN'), cls.removeStudent);

// EXPERIENCE
router.get('/experience', authenticate, authorizeRole('SALE'), experience.getAll);
router.get('/experience/stats', authenticate, authorizeRole('SALE'), experience.getStats);
router.get('/experience/month', authenticate, authorizeRole('SALE'), experience.getByMonth);
router.get('/experience/:id', authenticate, authorizeRole('SALE'), experience.getById);
router.post('/experience', authenticate, authorizeRole('SALE'), experience.create);
router.put('/experience/:id', authenticate, authorizeRole('SALE'), experience.update);
router.delete('/experience/:id', authenticate, authorizeRole('SALE'), experience.remove);

// TRIAL (Legacy - sẽ được thay thế bởi leads)
router.get('/trial-students', authenticate, authorizeRole('SALE'), trial.getAll);
router.get('/trial-students/stats', authenticate, authorizeRole('SALE'), trial.getStats);
router.get('/trial-students/:id', authenticate, authorizeRole('SALE'), trial.getById);
router.post('/trial-students', authenticate, authorizeRole('SALE'), trial.create);
router.put('/trial-students/:id', authenticate, authorizeRole('SALE'), trial.update);
router.post('/trial-students/:id/convert', authenticate, authorizeRole('SALE'), trial.convert);
router.delete('/trial-students/:id', authenticate, authorizeRole('SALE'), trial.remove);

// LEADS (Gộp trải nghiệm + học thử)
// EC, SALE, HOEC, OM, ADMIN được truy cập
const leadRoles = ['EC', 'SALE', 'HOEC', 'OM', 'ADMIN'];
router.get('/leads', authenticate, authorizeRole(...leadRoles), lead.getAll);
router.get('/leads/stats', authenticate, authorizeRole(...leadRoles), lead.getStats);
router.get('/leads/month', authenticate, authorizeRole(...leadRoles), lead.getByMonth);
router.get('/leads/check-phone', authenticate, authorizeRole(...leadRoles), lead.checkPhone);
router.get('/leads/:id', authenticate, authorizeRole(...leadRoles), lead.getById);
router.post('/leads', authenticate, authorizeRole(...leadRoles), lead.create);
router.put('/leads/:id', authenticate, authorizeRole(...leadRoles), lead.update);
router.delete('/leads/:id', authenticate, authorizeRole('HOEC', 'OM', 'ADMIN'), lead.remove); // Chỉ manager được xóa
router.post('/leads/:id/attended', authenticate, authorizeRole(...leadRoles), lead.markAttended);
router.post('/leads/:id/no-show', authenticate, authorizeRole(...leadRoles), lead.markNoShow);
router.post('/leads/:id/complete-session', authenticate, authorizeRole(...leadRoles), lead.completeSession);
router.post('/leads/:id/schedule', authenticate, authorizeRole(...leadRoles), lead.assignTrialClass); // Đặt lịch trải nghiệm
router.post('/leads/:id/assign-class', authenticate, authorizeRole(...leadRoles), lead.assignTrialClass); // Legacy alias
router.post('/leads/:id/convert', authenticate, authorizeRole(...leadRoles), lead.convertToStudent);
router.post('/leads/:id/call-log', authenticate, authorizeRole(...leadRoles), lead.addCallLog);
router.get('/leads/:id/call-logs', authenticate, authorizeRole(...leadRoles), lead.getCallLogs);

// SESSIONS
router.get('/sessions', authenticate, authorize('session.view'), session.getAll);
router.get('/sessions/today', authenticate, session.getToday);
router.get('/sessions/:id', authenticate, authorize('session.view'), session.getById);
router.post('/sessions', authenticate, authorizeRole('CM', 'ADMIN'), session.create);
router.post('/sessions/generate', authenticate, authorizeRole('CM', 'ADMIN'), session.generate);
router.put('/sessions/:id', authenticate, authorizeRole('CM', 'ADMIN', 'TEACHER'), session.update);
router.delete('/sessions/:id', authenticate, authorizeRole('ADMIN'), session.remove);

// ATTENDANCE
router.get('/attendance/session/:sessionId/students', authenticate, attendance.getStudentsForSession);
router.post('/attendance/session/:sessionId/mark', authenticate, authorizeRole('TEACHER', 'CM', 'ADMIN'), attendance.markAttendance);
router.get('/attendance/class/:classId/report', authenticate, attendance.getClassReport);
router.put('/attendance/:id', authenticate, authorizeRole('TEACHER', 'CM', 'ADMIN'), attendance.update);

// ASSIGNMENTS
router.get('/assignments', authenticate, authorize('assignment.view'), assignment.getAll);
router.get('/assignments/:id', authenticate, authorize('assignment.view'), assignment.getById);
router.get('/assignments/:id/submissions', authenticate, assignment.getSubmissions);
router.post('/assignments', authenticate, authorizeRole('TEACHER', 'CM', 'ADMIN'), assignment.create);
router.put('/assignments/:id', authenticate, authorizeRole('TEACHER', 'CM', 'ADMIN'), assignment.update);
router.delete('/assignments/:id', authenticate, authorizeRole('TEACHER', 'CM', 'ADMIN'), assignment.remove);
router.post('/assignments/:submissionId/grade', authenticate, authorizeRole('TEACHER', 'ADMIN'), assignment.grade);

// FILES (Cloudinary)
router.get('/files', authenticate, file.getAll);
router.get('/files/:id', authenticate, file.getById);
router.post('/files/upload', authenticate, upload.array('files', 10), file.upload);
router.delete('/files/:id', authenticate, file.remove);

// COMMON
router.get('/common/subjects', authenticate, common.getSubjects);
router.get('/common/levels', authenticate, common.getLevels);
router.post('/common/subjects', authenticate, authorizeRole('ADMIN'), common.createSubject);
router.post('/common/levels', authenticate, authorizeRole('ADMIN'), common.createLevel);
router.get('/notifications', authenticate, common.getNotifications);
router.put('/notifications/:id/read', authenticate, common.markNotificationRead);
router.put('/notifications/read-all', authenticate, common.markAllNotificationsRead);

// PACKAGES
import * as pkg from '../controllers/packageController.js';
router.get('/packages', authenticate, pkg.getAll);
router.get('/packages/branch-prices', authenticate, authorizeRole('ADMIN'), pkg.getBranchPrices);
router.get('/packages/calculate', authenticate, pkg.calculateSessions);
router.get('/packages/:id', authenticate, pkg.getById);
router.post('/packages', authenticate, authorizeRole('ADMIN'), pkg.create);
router.put('/packages/:id', authenticate, authorizeRole('ADMIN'), pkg.update);
router.delete('/packages/:id', authenticate, authorizeRole('ADMIN'), pkg.remove);
router.post('/packages/branch-price', authenticate, authorizeRole('ADMIN'), pkg.setBranchPrice);
router.post('/packages/branch-prices/bulk', authenticate, authorizeRole('ADMIN'), pkg.bulkSetBranchPrices);

// SALE REPORTS & KPI
import * as saleReport from '../controllers/saleReportController.js';
router.get('/sale-reports/my', authenticate, authorizeRole('EC'), saleReport.getMyReport);
router.get('/sale-reports', authenticate, authorizeRole('HOEC', 'ADMIN', 'CHU'), saleReport.getAllReports);
router.get('/sale-reports/summary', authenticate, authorizeRole('HOEC', 'ADMIN', 'CHU'), saleReport.getSummary);
router.get('/sale-reports/ranking/revenue', authenticate, saleReport.getRankingRevenue);
router.get('/sale-reports/ranking/kpi', authenticate, saleReport.getRankingKpi);
router.post('/sale-reports/calculate', authenticate, authorizeRole('ADMIN'), saleReport.calculateReport);
router.post('/sale-reports/calculate-all', authenticate, authorizeRole('ADMIN'), saleReport.calculateAllReports);

// KPI
router.get('/kpi/targets', authenticate, authorizeRole('HOEC', 'ADMIN'), saleReport.getKpiTargets);
router.post('/kpi/target', authenticate, authorizeRole('HOEC', 'ADMIN'), saleReport.setKpiTarget);
router.post('/kpi/targets/bulk', authenticate, authorizeRole('HOEC', 'ADMIN'), saleReport.bulkSetKpi);

// DASHBOARD
router.get('/dashboard/admin', authenticate, authorizeRole('ADMIN'), dashboard.getAdmin);
router.get('/dashboard/owner', authenticate, authorizeRole('CHU', 'ADMIN'), dashboard.getOwner);
router.get('/dashboard/hoec', authenticate, authorizeRole('HOEC'), dashboard.getHoec);
router.get('/dashboard/om', authenticate, authorizeRole('OM'), dashboard.getOm);
router.get('/dashboard/cm', authenticate, authorizeRole('CM'), dashboard.getCM);
router.get('/dashboard/ec', authenticate, authorizeRole('EC'), dashboard.getSale);
router.get('/dashboard/teacher', authenticate, authorizeRole('TEACHER'), dashboard.getTeacher);
// Backward compatibility
router.get('/dashboard/sale', authenticate, authorizeRole('EC', 'SALE'), dashboard.getSale);

// CALL (Twilio)
import * as call from '../controllers/callController.js';
router.get('/call/token', authenticate, call.getToken);
router.get('/call/config', authenticate, call.getConfig);
router.post('/call/twiml', call.twiml); // TwiML webhook (no auth)

export default router;