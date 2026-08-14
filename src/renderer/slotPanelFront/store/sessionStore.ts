// store/sessionStore.ts
import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { TabManager } from '../core/tab/TabManager';
import { EditorSession } from '../core/editor/EditorSession';
import type { EditorSessionType } from '../core/models/editor/EditorTypes';

// 实例化 Manager
const tabManager = new TabManager();

export const useSessionStore = defineStore('sessionStore', () => {
  // --- State ---
  const editorSessions = ref<EditorSession[]>([]);
  const activeSessionId = ref<string | null>(null);

  // --- Actions ---

  // 1. 创建
  const createSession = (type: EditorSessionType, args?: any) => {
    const newSession = new EditorSession(type, args);
    const sessionRaw = markRaw(newSession);

    editorSessions.value.push(sessionRaw);

    activateSession(sessionRaw.id);

    return sessionRaw;
  };

  // 2. 激活/切换
  const activateSession = (id: string) => {
    // 检查 id 是否存在（安全起见）
    const exists = editorSessions.value.find(s => s.id === id);
    if (exists) {
      activeSessionId.value = id;
      // 通知 Manager 记录历史
      tabManager.trackActiveId(id);
    }
  };

  // 3. 关闭
  const closeSession = (targetId: string) => {
    // A. 计算下一个该激活谁 (在删除之前问 Manager)
    // 注意：我们需要先确定下一个 ID，再从数组里删掉，
    // 因为 TabManager 现在的逻辑是纯 ID 操作，它不知道 Store 里还没删。
    const currentIds = editorSessions.value.map(s => s.id);
    let nextId = activeSessionId.value;

    if (activeSessionId.value === targetId) {
      // 如果关掉的是当前激活的，才需要计算下一个
      nextId = tabManager.getNextActiveIdAfterClose(targetId, currentIds);

      // 如果 Manager 没返回（比如这是最后一个），兜底逻辑：取数组里前一个
      if (!nextId && editorSessions.value.length > 1) {
        const index = editorSessions.value.findIndex(s => s.id === targetId);
        nextId = index > 0 ? editorSessions.value[index - 1].id : editorSessions.value[1]?.id ?? null;
      }
    } else {
      // 关掉的不是当前激活的，只需从历史中移除，不用改变 activeId
      tabManager.getNextActiveIdAfterClose(targetId, currentIds); // 纯粹为了副作用：清理历史
    }

    // B. 执行销毁逻辑
    const sessionIndex = editorSessions.value.findIndex(s => s.id === targetId);
    if (sessionIndex > -1) {
      // 调用实例的 dispose 释放资源
      editorSessions.value[sessionIndex].dispose();
      // 从数组移除
      editorSessions.value.splice(sessionIndex, 1);
    }

    // C. 更新激活 ID
    // 如果全部关完了
    if (editorSessions.value.length === 0) {
      activeSessionId.value = null;
      tabManager.clear();
    } else if (activeSessionId.value === targetId) {
      // 切换到计算出来的下一个 ID
      activeSessionId.value = nextId;
    }
  };

  const getSessionById = (id: string) => {
    return editorSessions.value.find(s => s.id === id);
  };

  return {
    editorSessions,
    activeSessionId,
    createSession,
    activateSession,
    closeSession,
    getSessionById,
  };
});
