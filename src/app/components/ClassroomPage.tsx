import { useState } from 'react';
import { Lock, Play, Star, ChevronRight, Clock, BookOpen, Users, Crown } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

const COURSES = [
  {
    id: 1,
    title: '象形字母全解析',
    subtitle: '26个字母的象形起源与含义',
    tag: '核心基础',
    tagColor: '#0E3A5C',
    tagBg: '#DBEEFF',
    price: 0,
    priceLabel: '免费',
    lessons: 12,
    hours: '4.5小时',
    rating: 4.9,
    reviews: 328,
    students: '2,841',
    isFree: true,
    isNew: false,
    coverImg: 'https://images.unsplash.com/photo-1764312349540-e9a4dfe2f8e2?w=400&q=60',
    description: '从古埃及象形文字出发，逐一解析26个英语字母的象形含义与视觉逻辑，是理解所有词根的核心基础。',
    instructor: '《象形英语》作者',
    progress: 75,
    enrolled: true,
  },
  {
    id: 2,
    title: 'CET-4 高频词根特训',
    subtitle: '用象形逻辑攻克四级核心词汇',
    tag: 'CET-4',
    tagColor: '#065F46',
    tagBg: '#D1FAE5',
    price: 199,
    priceLabel: '¥199',
    lessons: 20,
    hours: '8小时',
    rating: 4.8,
    reviews: 156,
    students: '1,203',
    isFree: false,
    isNew: false,
    coverImg: 'https://images.unsplash.com/photo-1543165796-5426273eaab3?w=400&q=60',
    description: '系统梳理四级高频单词背后的词根逻辑，每节课聚焦一个核心词根，辐射10-15个相关词汇。',
    instructor: '《象形英语》作者',
    progress: 0,
    enrolled: false,
  },
  {
    id: 3,
    title: '单词记忆训练营·中小学版',
    subtitle: '趣味象形，30天突破1200词',
    tag: '训练营',
    tagColor: '#7A3800',
    tagBg: '#FFEDCC',
    price: 499,
    priceLabel: '¥499',
    lessons: 30,
    hours: '30天打卡',
    rating: 5.0,
    reviews: 89,
    students: '462',
    isFree: false,
    isNew: true,
    coverImg: 'https://images.unsplash.com/photo-1557734864-c78b6dfef1b1?w=400&q=60',
    description: '专为中小学生设计，结合趣味象形图、记忆游戏与每日打卡，30天内系统掌握1200个核心单词。',
    instructor: '《象形英语》作者',
    progress: 0,
    enrolled: false,
  },
  {
    id: 4,
    title: '词根词缀完全手册',
    subtitle: '200+词根，贯通英语词汇体系',
    tag: '进阶',
    tagColor: '#5B21B6',
    tagBg: '#EDE9FE',
    price: 299,
    priceLabel: '¥299',
    lessons: 25,
    hours: '10小时',
    rating: 4.7,
    reviews: 64,
    students: '387',
    isFree: false,
    isNew: false,
    coverImg: 'https://images.unsplash.com/photo-1731571456417-09baaee2bde6?w=400&q=60',
    description: '系统整理200+拉丁语和希腊语词根，结合象形英语的视觉记忆法，让你从词根层面彻底贯通英语词汇。',
    instructor: '《象形英语》作者',
    progress: 30,
    enrolled: true,
  },
];

const CATEGORIES = ['全部', '我的课程', '免费', '基础', '进阶', '训练营'];

const FEATURED_COURSE = COURSES[0];

function CourseCard({ course, onOpen }: { course: typeof COURSES[0]; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="rounded-2xl overflow-hidden cursor-pointer active:scale-[0.99] transition-all"
      style={{ background: 'white', border: '1px solid #ECECEC', boxShadow: '0 4px 16px rgba(14,58,92,0.07)' }}
    >
      {/* Cover */}
      <div className="relative overflow-hidden" style={{ height: 120 }}>
        <ImageWithFallback
          src={course.coverImg}
          alt={course.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.2)' }} />
        {/* Badges */}
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ background: course.tagBg, color: course.tagColor }}
          >
            {course.tag}
          </span>
          {course.isNew && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: '#FEE2E2', color: '#B91C1C' }}
            >
              NEW
            </span>
          )}
        </div>
        <div className="absolute top-2.5 right-2.5">
          <span
            className="rounded-full px-2.5 py-1 text-sm font-bold"
            style={{
              background: course.isFree ? '#D1FAE5' : '#0E3A5C',
              color: course.isFree ? '#065F46' : '#FFEBA2',
            }}
          >
            {course.priceLabel}
          </span>
        </div>
        {course.enrolled && (
          <div className="absolute bottom-2.5 left-2.5 right-2.5">
            <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.3)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${course.progress}%`, background: '#FE8500' }}
              />
            </div>
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, marginTop: 2, display: 'block' }}>
              已完成 {course.progress}%
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5">
        <h3 style={{ color: '#0E3A5C', margin: '0 0 2px', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
          {course.title}
        </h3>
        <p style={{ color: '#6BAED6', fontSize: 11, margin: '0 0 8px', lineHeight: 1.4 }}>
          {course.subtitle}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Star size={11} color="#FE8500" fill="#FE8500" />
            <span style={{ fontSize: 11, color: '#0E3A5C', fontWeight: 600 }}>{course.rating}</span>
            <span style={{ fontSize: 10, color: '#6BAED6' }}>({course.reviews})</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock size={10} color="#6BAED6" />
            <span style={{ fontSize: 10, color: '#6BAED6' }}>{course.hours}</span>
          </div>
          <div className="flex items-center gap-1">
            <Users size={10} color="#6BAED6" />
            <span style={{ fontSize: 10, color: '#6BAED6' }}>{course.students}人学习</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CourseDetailModal({ course, onClose }: { course: typeof COURSES[0]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl overflow-hidden"
        style={{ maxWidth: 430, background: '#F0F9FF', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cover */}
        <div className="relative" style={{ height: 180 }}>
          <ImageWithFallback src={course.coverImg} alt={course.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} />
          <div className="absolute bottom-4 left-5 right-5">
            <div className="flex gap-2 mb-2">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: course.tagBg, color: course.tagColor }}>{course.tag}</span>
            </div>
            <h2 style={{ color: 'white', margin: 0, fontSize: 20, fontWeight: 700 }}>{course.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: 'rgba(0,0,0,0.4)', color: 'white' }}
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { icon: <BookOpen size={14} color="#FE8500" />, value: `${course.lessons}节`, label: '课程数量' },
              { icon: <Clock size={14} color="#FE8500" />, value: course.hours, label: '学习时长' },
              { icon: <Star size={14} color="#FE8500" fill="#FE8500" />, value: String(course.rating), label: `${course.reviews}条评价` },
            ].map(({ icon, value, label }) => (
              <div key={label} className="rounded-xl p-3 flex flex-col items-center" style={{ background: 'white', border: '1px solid #ECECEC' }}>
                {icon}
                <span style={{ color: '#0E3A5C', fontWeight: 700, fontSize: 15, marginTop: 4 }}>{value}</span>
                <span style={{ color: '#6BAED6', fontSize: 10 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="rounded-xl p-4 mb-4" style={{ background: 'white', border: '1px solid #ECECEC' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#6BAED6', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              课程介绍
            </p>
            <p style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.7, margin: 0 }}>{course.description}</p>
          </div>

          {/* Instructor */}
          <div className="flex items-center gap-3 rounded-xl p-3 mb-4" style={{ background: 'white', border: '1px solid #ECECEC' }}>
            <div
              className="flex items-center justify-center rounded-full flex-shrink-0"
              style={{ width: 44, height: 44, background: 'linear-gradient(135deg, #0E3A5C, #1A5A8A)', color: '#FFEBA2', fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700 }}
            >
              象
            </div>
            <div>
              <p style={{ fontWeight: 600, color: '#0E3A5C', margin: 0, fontSize: 13 }}>{course.instructor}</p>
              <p style={{ color: '#6BAED6', fontSize: 11, margin: 0 }}>《象形英语》著作者 · 语言学研究者</p>
            </div>
          </div>

          {/* CTA */}
          {course.isFree ? (
            <button
              className="w-full flex items-center justify-center gap-2 rounded-xl py-4"
              style={{ background: 'linear-gradient(135deg, #FE8500 0%, #FFAB40 100%)', color: 'white', fontWeight: 700, fontSize: 16, boxShadow: '0 6px 20px rgba(254,133,0,0.3)' }}
            >
              <Play size={18} fill="white" /> 立即开始学习（免费）
            </button>
          ) : course.enrolled ? (
            <button
              className="w-full flex items-center justify-center gap-2 rounded-xl py-4"
              style={{ background: '#0E3A5C', color: 'white', fontWeight: 700, fontSize: 16 }}
            >
              <Play size={18} fill="white" /> 继续学习 · {course.progress}% 已完成
            </button>
          ) : (
            <div className="space-y-2">
              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl py-4"
                style={{ background: 'linear-gradient(135deg, #0E3A5C 0%, #1A5A8A 100%)', color: 'white', fontWeight: 700, fontSize: 16 }}
              >
                <Crown size={16} color="#FFEBA2" /> 立即购买 · {course.priceLabel}
              </button>
              <button
                className="w-full flex items-center justify-center gap-2 rounded-xl py-3"
                style={{ background: '#F0F9FF', color: '#6BAED6', fontSize: 14, border: '1px solid #ECECEC' }}
              >
                <Lock size={14} /> 免费试听前2节
              </button>
            </div>
          )}

          <p style={{ color: '#6BAED6', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            购买后永久有效 · 随时回看 · 不满意全额退款
          </p>
        </div>
      </div>
    </div>
  );
}

export function ClassroomPage() {
  const [activeCategory, setActiveCategory] = useState('全部');
  const [selectedCourse, setSelectedCourse] = useState<typeof COURSES[0] | null>(null);

  const filteredCourses = COURSES.filter((c) => {
    if (activeCategory === '全部') return true;
    if (activeCategory === '我的课程') return c.enrolled;
    if (activeCategory === '免费') return c.isFree;
    if (activeCategory === '基础') return c.tag === '核心基础';
    if (activeCategory === '进阶') return c.tag === '进阶';
    if (activeCategory === '训练营') return c.tag === '训练营';
    return true;
  });

  return (
    <>
      {selectedCourse && (
        <CourseDetailModal course={selectedCourse} onClose={() => setSelectedCourse(null)} />
      )}

      <div style={{ background: '#F0F9FF', minHeight: '100%' }}>

        {/* Header */}
        <div className="px-5 pt-12 pb-5" style={{ background: 'linear-gradient(160deg, #0E3A5C 0%, #1A5A8A 100%)' }}>
          <h1 style={{ color: 'white', margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>课堂</h1>
          <p style={{ color: 'rgba(169,226,255,0.6)', margin: 0, fontSize: 13 }}>系统课程 · 从字母到词汇</p>
        </div>

        {/* Featured Banner */}
        <div
          className="mx-4 mt-4 rounded-2xl overflow-hidden relative cursor-pointer active:scale-[0.99] transition-all"
          style={{ boxShadow: '0 8px 24px rgba(14,58,92,0.18)' }}
          onClick={() => setSelectedCourse(FEATURED_COURSE)}
        >
          <div className="relative" style={{ height: 160 }}>
            <ImageWithFallback
              src={FEATURED_COURSE.coverImg}
              alt={FEATURED_COURSE.title}
              className="w-full h-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to right, rgba(30,27,75,0.85) 40%, rgba(30,27,75,0.3) 100%)' }}
            />
            <div className="absolute inset-0 p-4 flex flex-col justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: '#D1FAE5', color: '#065F46' }}>
                  🎓 精选课程
                </span>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: '#D1FAE5', color: '#065F46' }}>
                  完全免费
                </span>
              </div>
              <div>
                <h3 style={{ color: 'white', margin: '0 0 4px', fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>
                  {FEATURED_COURSE.title}
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.7)', margin: '0 0 10px', fontSize: 12 }}>
                  {FEATURED_COURSE.subtitle}
                </p>
                <div className="flex items-center gap-3">
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>
                    ⭐ {FEATURED_COURSE.rating} · {FEATURED_COURSE.students} 人已学
                  </span>
                </div>
              </div>
            </div>

            {/* Progress */}
            {FEATURED_COURSE.enrolled && (
              <div className="absolute bottom-3 right-3">
                <div
                  className="flex items-center justify-center rounded-full"
                  style={{ width: 44, height: 44, background: '#FE8500', boxShadow: '0 4px 12px rgba(254,133,0,0.4)' }}
                >
                  <Play size={16} color="white" fill="white" style={{ marginLeft: 2 }} />
                </div>
              </div>
            )}
          </div>

          {/* Mini progress bar */}
          {FEATURED_COURSE.enrolled && (
            <div style={{ background: '#0E3A5C', padding: '8px 16px' }}>
              <div className="flex items-center justify-between mb-1">
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>学习进度</span>
                <span style={{ color: '#FFEBA2', fontSize: 11, fontWeight: 600 }}>{FEATURED_COURSE.progress}%</span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.1)' }}>
                <div className="h-full rounded-full" style={{ width: `${FEATURED_COURSE.progress}%`, background: '#FE8500' }} />
              </div>
            </div>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex gap-2 px-4 py-3 overflow-x-auto mt-4" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="flex-shrink-0 rounded-full px-4 py-1.5 text-sm transition-all"
              style={{
                background: activeCategory === cat ? '#0E3A5C' : 'white',
                color: activeCategory === cat ? 'white' : '#6BAED6',
                fontWeight: activeCategory === cat ? 600 : 400,
                border: activeCategory === cat ? 'none' : '1px solid #ECECEC',
                boxShadow: activeCategory === cat ? '0 4px 12px rgba(14,58,92,0.2)' : '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              {cat}
              {cat === '我的课程' && (
                <span className="ml-1.5 rounded-full px-1.5" style={{ background: '#FE8500', color: 'white', fontSize: 9 }}>
                  {COURSES.filter((c) => c.enrolled).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Course Grid */}
        <div className="px-4 space-y-4 pb-4">
          {filteredCourses.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2">
              <div style={{ fontSize: 40 }}>📚</div>
              <p style={{ color: '#6BAED6', fontSize: 13 }}>该分类暂无课程</p>
            </div>
          ) : (
            filteredCourses.map((course) => (
              <CourseCard key={course.id} course={course} onOpen={() => setSelectedCourse(course)} />
            ))
          )}
        </div>

        {/* Bottom Promo */}
        <div
          className="mx-4 mb-4 rounded-2xl p-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #EBF8FF 0%, #DBEEFF 100%)', border: '1px solid #A9E2FF' }}
        >
          <div style={{ fontSize: 28 }}>✉️</div>
          <div className="flex-1">
            <p style={{ fontWeight: 600, color: '#0E3A5C', margin: 0, fontSize: 13 }}>订阅新课通知</p>
            <p style={{ color: '#2A6A9A', margin: 0, fontSize: 11 }}>第一时间获取新系列课程上线消息</p>
          </div>
          <button
            className="flex items-center gap-1 rounded-xl px-3 py-2"
            style={{ background: '#FE8500', color: 'white', fontSize: 12, fontWeight: 600, flexShrink: 0 }}
          >
            订阅 <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </>
  );
}