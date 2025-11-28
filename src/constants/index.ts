// Time intervals
export const INTERVALS = {
  CRONJOB: 60 * 1000, // 1 minute
  TOKEN_CACHE_DURATION: 23 * 60 * 60 * 1000, // 23 hours
  CARD_CACHE_DURATION: 60 * 60 * 1000, // 1 hour
} as const;

// Probabilities
export const PROBABILITIES = {
  SEND_CARD: 0.2, // 1/5 chance (20%)
} as const;

// API Configuration
export const API = {
  NOJI_BASE_URL: 'https://api-de.noji.io/api',
  NOJI_WEB_URL: 'https://noji.io',
  NOTES_LIMIT: 100, // Items per page when fetching notes
} as const;

// Section headers that should be auto-formatted (bold + line breaks)
export const CARD_SECTIONS = [
  'IPA',
  'Examples?',
  'Usage',
  'Collocations?',
  'Origin',
  "Synonyms"
] as const;

export const getPrompt = (q: string) => `
Bạn là chuyên gia từ điển Anh-Việt chính thống, chỉ sử dụng dữ liệu từ Cambridge Dictionary, Longman Dictionary hoặc Oxford Dictionary để tạo định nghĩa chính xác và tự nhiên nhất cho người học tiếng Anh.

Cụm/Từ cần tra: "${q}"

BẮT BUỘC trả về ĐÚNG và ĐỦ các phần sau, không được bỏ bất kỳ phần nào, không thêm chữ thừa, không giải thích:

*${q.trim().toLowerCase()}* ${q.includes(' ') ? '' : '(từ loại) '}

nghĩa tiếng Việt ngắn gọn từ Từ Điển • nghĩa phụ nếu có
${q.includes(' ') ? '' : 'IPA: /phiên âm Mỹ chuẩn/'}
${q.includes(' ') ? '' : 'Synonyms: từ đồng nghĩa (2–3 từ) • Antonyms: từ trái nghĩa (1–2 từ)'}

Examples
• Câu ví dụ lấy trực tiếp hoặc dựa sát vào Từ Điển.
  → Dịch tự nhiên + sát nghĩa.
• Câu ví dụ thứ hai khác ngữ cảnh.
  → Dịch tương ứng.

Collocations
mỗi dòng một collocation hoặc pattern phổ biến (3–5 cái)

Usage
ngữ cảnh thường dùng • phong cách • đối tượng hay nói

Nếu cụm này có nguồn gốc lịch sử / văn hóa thật sự thú vị và nổi tiếng thì thêm đúng 1 phần:
Origin
nguồn gốc cực ngắn bằng tiếng Việt, dưới 22 từ
Nếu không đủ thú vị hoặc không rõ ràng thì KHÔNG thêm phần Origin.

[sound:https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(q)}]
`.trim()