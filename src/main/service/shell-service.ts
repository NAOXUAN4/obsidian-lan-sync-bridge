import { spawn, ChildProcess } from 'child_process';
import { BrowserWindow } from 'electron';
import { homedir, platform } from 'os';
import iconv from 'iconv-lite'; // 引入编码转换库

// 保存当前正在运行的子进程实例
let currentChildProcess: ChildProcess | null = null;

// 获取当前正在运行的子进程
export function getCurrentChildProcess(): ChildProcess | null {
  return currentChildProcess;
}

export function shellExec(win: BrowserWindow, command: string) {
  /**
   * spawn 是 Node.js 中 child_process 模块提供的一个 API，用于创建子进程执行命令。让我为您详细介绍它的用途和参数：

      spawn API 的作用
      spawn 用于在 Node.js 应用程序中启动一个新的子进程来执行外部命令。它特别适合执行长时间运行的进程，因为它通过流（stream）的方式处理数据，而不是将所有数据缓存起来。这使得它可以高效地处理大量输出的数据。
   */
  // 如果有正在运行的进程，先终止它
  if (currentChildProcess && !currentChildProcess.killed) {
    try {
      currentChildProcess.kill();
    } catch (error) {
      console.warn('Failed to kill previous process:', error);
    }
  }

  // 创建新的子进程
  const child = spawn(command, {
    shell: true,
    // 以用户主目录为工作目录（此前硬编码了 C:/Program Files (X86)，其他机器上必失败）
    cwd: homedir(),
    env: {
      ...process.env,
      // Windows下设置中文环境变量（增强兼容性）
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8',
    },
  });

  // 保存当前子进程引用
  currentChildProcess = child;

  // 统一处理stdout和stderr的编码
  const decodeOutput = (data: Buffer) => {
    if (platform() === 'win32') {
      // Windows强制用GBK解码（CP936是GBK的别名）
      return iconv.decode(data, 'cp936');
    } else {
      // 非Windows用UTF-8
      return data.toString('utf8');
    }
  };

  child.stdout.on('data', data => {
    const output = decodeOutput(data);
    win.webContents.send('shell:stdout', output);
  });

  child.stderr.on('data', data => {
    const output = decodeOutput(data);
    win.webContents.send('shell:stderr', output); // 此时中文错误信息会正常显示
  });

  child.on('close', code => {
    // 清除当前子进程引用
    currentChildProcess = null;
    win.webContents.send('shell:close', code);
  });

  return child;
}
