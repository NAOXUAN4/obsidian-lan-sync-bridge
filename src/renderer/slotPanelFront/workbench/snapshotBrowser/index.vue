<template>
  <div class="flex h-full bg-[#141414]">
    <!-- File list -->
    <div class="w-72 shrink-0 border-r border-white/[0.04] overflow-y-auto bg-[#0d0d0d]">
      <div class="px-3 py-3 text-[10px] font-medium uppercase tracking-[0.15em] text-[#666]">Snapshots</div>
      <div v-if="files.length === 0" class="px-3 py-6 text-center text-xs text-[#555]">
        No snapshots yet.
        <br />
        Sync from phone to create history.
      </div>

      <!-- Date groups -->
      <div v-for="group in dateGroups" :key="group.label">
        <div
          class="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-[#888] hover:text-[#ccc] transition-colors select-none"
          @click="toggleGroup(group.label)"
        >
          <ChevronRight
            :class="collapsedGroups.has(group.label) ? '' : 'rotate-90'"
            class="size-3 shrink-0 transition-transform"
          />
          <span>{{ group.label }}</span>
          <span class="text-[10px] text-[#555]">({{ group.fileCount }} files)</span>
        </div>

        <template v-if="!collapsedGroups.has(group.label)">
          <div
            v-for="f in group.files"
            :key="f.filePath"
            :class="selectedFile === f.filePath
              ? 'bg-[#1a1a1a] text-white border-l-[3px] border-l-[#5e6ad2] pl-[9px]'
              : 'text-[#999] hover:bg-[#161616] hover:text-[#ccc] border-l-[3px] border-l-transparent pl-3'"
            class="group flex cursor-pointer items-center justify-between py-1.5 pr-2 text-xs font-mono leading-relaxed transition-colors"
            :title="f.filePath"
            @click="selectFile(f)"
          >
            <span class="break-all min-w-0 flex-1">{{ f.filePath || '(root)' }}</span>
            <span class="ml-1 shrink-0 rounded bg-[#1f1f1f] px-1.5 py-0.5 text-[10px] text-[#666]">{{ f.snapshots.length }}</span>
            <button
              class="ml-1 shrink-0 rounded p-0.5 text-[#555] opacity-0 transition-all hover:bg-[#2a1515] hover:text-[#e5484d] group-hover:opacity-100"
              title="Delete all snapshots for this file"
              @click.stop="deleteAllSnapshots(f)"
            >
              <Trash2 class="size-3" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Versions + Diff -->
    <div class="flex flex-1 flex-col min-w-0 overflow-hidden">
      <div v-if="!selectedFile" class="flex flex-1 items-center justify-center text-sm text-[#555]">
        Select a file to view version history
      </div>
      <template v-else>
        <!-- Version timeline -->
        <div class="flex flex-wrap items-center gap-1.5 border-b border-white/[0.04] px-4 py-2.5">
          <span class="mr-1 shrink-0 text-[10px] font-medium uppercase tracking-[0.15em] text-[#666]">Versions</span>
          <button
            v-for="snap in selectedSnapshots"
            :key="snap.path"
            :class="selectedSnapshot === snap.path
              ? 'bg-[#5e6ad2] text-white'
              : 'bg-[#0d0d0d] text-[#888] hover:bg-[#1a1a1a] hover:text-[#ccc]'"
            class="group/ver flex shrink-0 items-center gap-1 rounded px-2.5 py-1 text-[11px] font-mono transition-colors"
            :title="snap.name"
          >
            <span class="cursor-pointer" @click="selectSnapshot(snap)">{{ displayName(snap.name) }}</span>
            <X
              class="size-3 cursor-pointer text-[#555] opacity-0 transition-all hover:text-[#e5484d] group-hover/ver:opacity-100"
              @click.stop="deleteSingleSnapshot(snap)"
            />
          </button>
        </div>

        <!-- Diff area -->
        <div class="flex min-h-0 flex-1 flex-col bg-[#0d0d0d]">
          <DiffEditor
            v-if="selectedSnapshot && selectedFileData"
            :key="selectedSnapshot"
            :snapshotPath="selectedSnapshot"
            :currentPath="selectedFileData.currentPath"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ChevronRight, Trash2, X } from 'lucide-vue-next';
import DiffEditor from '../diffEditor/index.vue';

interface SnapshotEntry {
  name: string;
  path: string;
  mtime: number;
}

interface FileEntry {
  filePath: string;
  currentPath: string;
  snapshots: SnapshotEntry[];
}

interface DateGroup {
  label: string;
  order: number;
  fileCount: number;
  files: FileEntry[];
}

const files = ref<FileEntry[]>([]);
const selectedFile = ref('');
const selectedFileData = ref<FileEntry | null>(null);
const selectedSnapshot = ref('');
const collapsedGroups = ref(new Set<string>());
let cleanupSnapshot: (() => void) | null = null;
let cleanupStatus: (() => void) | null = null;

const selectedSnapshots = ref<SnapshotEntry[]>([]);

// Strip the extension, and render timestampId names (ISO with - in place of :/.):
// "2026-08-14T09-30-00-000Z.md" → "08-14 09:30:00"
function displayName(name: string): string {
  const stripped = name.replace(/\.[^.]*$/, '');
  const match = stripped.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
  return stripped;
}

function getDateLabel(ts: number): { label: string; order: number } {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  if (dStart === today) return { label: 'Today', order: 0 };
  if (dStart === yesterday) return { label: 'Yesterday', order: 1 };
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { label: `${y}-${m}-${day}`, order: 2 + (today - dStart) / 86400000 };
}

const dateGroups = computed<DateGroup[]>(() => {
  const map = new Map<string, { order: number; files: FileEntry[] }>();
  for (const f of files.value) {
    const latestMtime = f.snapshots[0]?.mtime || 0;
    const { label, order } = getDateLabel(latestMtime);
    if (!map.has(label)) map.set(label, { order, files: [] });
    map.get(label)!.files.push(f);
  }
  return [...map.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([label, v]) => ({ label, order: v.order, fileCount: v.files.length, files: v.files }));
});

function toggleGroup(label: string) {
  if (collapsedGroups.value.has(label)) {
    collapsedGroups.value.delete(label);
  } else {
    collapsedGroups.value.add(label);
  }
  collapsedGroups.value = new Set(collapsedGroups.value);
}

async function fetchSnapshots() {
  const res = await window.electronAPI!.invoke('sync:listSnapshots');
  if (res.ok) {
    files.value = res.files;
    if (selectedFile.value && !res.files.find((f: FileEntry) => f.filePath === selectedFile.value)) {
      selectedFile.value = '';
      selectedFileData.value = null;
      selectedSnapshot.value = '';
    }
  }
}

function selectFile(f: FileEntry) {
  selectedFile.value = f.filePath;
  selectedFileData.value = f;
  selectedSnapshots.value = f.snapshots;
  selectedSnapshot.value = f.snapshots[0]?.path || '';
}

function selectSnapshot(snap: SnapshotEntry) {
  selectedSnapshot.value = snap.path;
}

async function deleteSingleSnapshot(snap: SnapshotEntry) {
  await window.electronAPI!.invoke('sync:deleteSnapshot', snap.path);
  if (selectedSnapshot.value === snap.path) {
    selectedSnapshot.value = '';
  }
  await fetchSnapshots();
}

async function deleteAllSnapshots(f: FileEntry) {
  for (const snap of f.snapshots) {
    await window.electronAPI!.invoke('sync:deleteSnapshot', snap.path);
  }
  if (selectedFile.value === f.filePath) {
    selectedFile.value = '';
    selectedFileData.value = null;
    selectedSnapshot.value = '';
  }
  await fetchSnapshots();
}

onMounted(async () => {
  await fetchSnapshots();
  cleanupSnapshot = window.electronAPI!.on('sync:snapshot', () => {
    fetchSnapshots();
  });
  cleanupStatus = window.electronAPI!.on('webdav:statusChanged', () => {
    fetchSnapshots();
  });
});

onBeforeUnmount(() => {
  cleanupSnapshot?.();
  cleanupStatus?.();
});
</script>
