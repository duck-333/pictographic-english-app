import React from 'react';

// 注意这里：添加了 export
export const MascotBubble: React.FC = () => {
  return (
    <div className="flex items-center gap-2 p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20">
      <div className="w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center text-xl">
        🦉
      </div>
      <div className="text-sm text-white/90">
        Hi! 我是你的象形英语小助手，点击字母开启考古之旅吧！
      </div>
    </div>
  );
};

// 保留这个以防万一
export default MascotBubble;