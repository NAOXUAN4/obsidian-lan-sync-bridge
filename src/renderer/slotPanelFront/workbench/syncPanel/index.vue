<template>
  <div class="relative flex h-full flex-col items-center justify-center gap-6 bg-[#141414] p-8">
    <!-- Credentials button (top-right) -->
    <button
      class="absolute right-4 top-4 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[#888] transition-colors hover:bg-[#1a1a1a] hover:text-[#ccc]"
      title="WebDAV credentials"
      @click="openSettings"
    >
      <Settings class="size-4" />
      <span v-if="!credentialsSet" class="flex size-4 items-center justify-center rounded-full bg-[#e5484d] text-[10px] font-bold leading-none text-white">
        !
      </span>
    </button>

    <!-- Status -->
    <div class="flex items-center gap-3">
      <div
        :class="status.running ? 'bg-[#30a46c]' : 'bg-[#555]'"
        class="h-2.5 w-2.5 rounded-full transition-colors duration-300"
      />
      <span class="text-lg font-medium text-white">
        {{ status.running ? 'Server Running' : 'Server Stopped' }}
      </span>
    </div>

    <!-- Connection info -->
    <div v-if="status.running" class="w-full max-w-sm space-y-3 rounded-lg border border-white/[0.04] bg-[#0d0d0d] p-5">
      <div class="text-[10px] font-medium uppercase tracking-[0.15em] text-[#666]">Connection</div>

      <!-- LAN -->
      <div v-if="status.ips.lan.length">
        <div class="mb-1 text-[10px] text-[#888]">LAN</div>
        <div v-for="ip in status.ips.lan" :key="ip.address" class="font-mono text-sm text-[#ccc]">
          http://{{ ip.address }}:{{ status.port }}
          <span class="text-[11px] text-[#555] ml-1.5 font-sans">{{ ip.ifName }}</span>
        </div>
      </div>

      <!-- Tailscale -->
      <div v-if="status.ips.tailscale.length">
        <div class="mb-1 mt-2 text-[10px] text-[#888]">Tailscale</div>
        <div v-for="ip in status.ips.tailscale" :key="ip.address" class="font-mono text-sm text-[#ccc]">
          http://{{ ip.address }}:{{ status.port }}
          <span class="text-[11px] text-[#555] ml-1.5 font-sans">{{ ip.ifName }}</span>
        </div>
      </div>

      <!-- Other -->
      <div v-if="status.ips.other.length">
        <div class="mb-1 mt-2 text-[10px] text-[#888]">Other</div>
        <div v-for="ip in status.ips.other" :key="ip.address" class="font-mono text-sm text-[#555]">
          http://{{ ip.address }}:{{ status.port }}
          <span class="text-[11px] text-[#555] ml-1.5 font-sans">{{ ip.ifName }}</span>
        </div>
      </div>

      <div class="mt-2 font-mono text-[11px] text-[#666]">{{ status.vaultPath }}</div>
    </div>

    <div v-if="status.error" class="text-sm text-[#e5484d]">{{ status.error }}</div>

    <!-- Start/Stop -->
    <button
      :class="status.running
        ? 'border border-[#3d1f1f] bg-[#2a1515] text-[#e5484d] hover:bg-[#3d1f1f]'
        : 'bg-[#5e6ad2] text-white hover:bg-[#6c77e0]'"
      class="rounded-md px-6 py-2 text-sm font-medium transition-colors"
      @click="toggleServer"
    >
      {{ status.running ? 'Stop Server' : 'Start Server' }}
    </button>

    <div v-if="error" class="text-sm text-[#e5484d]">{{ error }}</div>
  </div>

  <!-- Credentials modal -->
  <Teleport to="body">
    <div
      v-if="showSettings"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="closeSettings"
    >
      <div class="w-80 rounded-lg border border-white/[0.06] bg-[#1a1a1a] p-5 shadow-2xl">
        <div class="mb-4 flex items-center justify-between">
          <span class="text-sm font-medium text-white">WebDAV Credentials</span>
          <button class="text-[#666] transition-colors hover:text-[#ccc]" @click="closeSettings">
            <X class="size-4" />
          </button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-[11px] text-[#888]">Username</label>
            <input
              v-model="username"
              type="text"
              autocomplete="off"
              placeholder="e.g. obsidian"
              class="w-full rounded bg-[#141414] px-3 py-2 text-sm text-[#ccc] outline-none ring-1 ring-white/[0.06] focus:ring-[#5e6ad2] placeholder:text-[#444]"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-[#888]">Password</label>
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="••••••••"
              class="w-full rounded bg-[#141414] px-3 py-2 text-sm text-[#ccc] outline-none ring-1 ring-white/[0.06] focus:ring-[#5e6ad2] placeholder:text-[#444]"
            />
          </div>
          <label class="flex cursor-pointer items-center gap-2 text-[11px] text-[#555]">
            <input v-model="showPassword" type="checkbox" class="accent-[#5e6ad2]" />
            Show password
          </label>
        </div>

        <div v-if="settingsError" class="mt-2 text-xs text-[#e5484d]">{{ settingsError }}</div>
        <div v-if="status.running" class="mt-2 text-[11px] text-[#888]">
          Takes effect on the next server start.
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button
            class="rounded-md px-3 py-1.5 text-xs text-[#888] transition-colors hover:text-[#ccc]"
            @click="closeSettings"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-[#5e6ad2] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#6c77e0]"
            @click="saveSettings"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, onBeforeUnmount } from 'vue';
import { Settings, X } from 'lucide-vue-next';

interface IPEntry {
  address: string;
  ifName: string;
}

interface CategorizedIPs {
  lan: IPEntry[];
  tailscale: IPEntry[];
  other: IPEntry[];
}

interface WebDAVStatus {
  running: boolean;
  port: number;
  vaultPath: string;
  ips: CategorizedIPs;
  auth: boolean;
  error?: string;
}

const status = reactive<WebDAVStatus>({
  running: false,
  port: 0,
  vaultPath: '',
  ips: { lan: [], tailscale: [], other: [] },
  auth: false,
});

const username = ref('');
const password = ref('');
const showPassword = ref(false);
const showSettings = ref(false);
const settingsError = ref('');
const credentialsSet = ref(false);
const error = ref('');

let cleanupStatus: (() => void) | null = null;

async function getActiveVaultPath(): Promise<string> {
  const res = await window.electronAPI!.invoke('vault:list');
  if (res.ok && res.activeId) {
    const active = res.presets.find((p: any) => p.id === res.activeId);
    if (active) return active.path;
  }
  return '';
}

async function loadConfig() {
  const res = await window.electronAPI!.invoke('webdav:getConfig');
  if (res.ok) {
    username.value = res.username || '';
    password.value = res.password || '';
    credentialsSet.value = !!res.username && !!res.password;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeSettings();
}

function openSettings() {
  loadConfig();
  settingsError.value = '';
  showSettings.value = true;
  window.addEventListener('keydown', onKeydown);
}

function closeSettings() {
  showSettings.value = false;
  settingsError.value = '';
  window.removeEventListener('keydown', onKeydown);
}

async function saveSettings() {
  const user = username.value.trim();
  if (!user || !password.value) {
    settingsError.value = 'Username and password are required.';
    return;
  }
  await window.electronAPI!.invoke('webdav:saveConfig', { username: user, password: password.value });
  credentialsSet.value = true;
  closeSettings();
}

async function toggleServer() {
  error.value = '';
  if (status.running) {
    const res = await window.electronAPI!.invoke('webdav:stop');
    Object.assign(status, res.status);
  } else {
    const vaultPath = await getActiveVaultPath();
    if (!vaultPath) {
      error.value = 'No vault selected. Add a vault in Vaults panel first.';
      return;
    }
    if (!credentialsSet.value) {
      error.value = 'Set WebDAV credentials first.';
      openSettings();
      return;
    }
    const res = await window.electronAPI!.invoke('webdav:start', vaultPath, undefined, {
      username: username.value.trim(),
      password: password.value,
    });
    if (res.ok) {
      Object.assign(status, res.status);
    } else {
      error.value = 'Failed to start server';
    }
  }
}

onMounted(async () => {
  const res = await window.electronAPI!.invoke('webdav:status');
  if (res.ok) Object.assign(status, res.status);
  await loadConfig();

  cleanupStatus = window.electronAPI!.on('webdav:statusChanged', (newStatus: WebDAVStatus) => {
    Object.assign(status, newStatus);
  });
});

onBeforeUnmount(() => {
  cleanupStatus?.();
  window.removeEventListener('keydown', onKeydown);
});
</script>
