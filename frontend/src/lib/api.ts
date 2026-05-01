import type {
  JobCreateRequest,
  JobSummary,
  JobTraceResponse,
  PresetsResponse,
  ProjectDetail,
  ProjectSummary,
  SettingsResponse,
  SettingsUpdateRequest,
  UploadResponse
} from "@/lib/types";

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Request failed.");
  }
  return data as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  return readResponse<T>(response);
}

export const api = {
  listProjects() {
    return request<ProjectSummary[]>("/api/projects");
  },
  createProject(name: string) {
    return request<ProjectSummary>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  },
  getProject(projectId: string) {
    return request<ProjectDetail>(`/api/projects/${projectId}`);
  },
  renameProject(projectId: string, name: string) {
    return request<ProjectSummary>(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
  },
  deleteProject(projectId: string) {
    return request<void>(`/api/projects/${projectId}`, {
      method: "DELETE",
      headers: {}
    });
  },
  uploadFiles(
    projectId: string,
    files: File[],
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
  ) {
    return new Promise<UploadResponse>((resolve, reject) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/projects/${projectId}/uploads`);
      xhr.responseType = "json";

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !onProgress) {
          return;
        }
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100)
        });
      };

      xhr.onload = () => {
        const response = xhr.response || JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(response as UploadResponse);
          return;
        }
        reject(new Error(response?.detail || "Upload failed."));
      };

      xhr.onerror = () => reject(new Error("Upload failed."));
      xhr.send(formData);
    });
  },
  renameFile(projectId: string, fileId: string, name: string) {
    return request(`/api/projects/${projectId}/files/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
  },
  deleteFile(projectId: string, fileId: string) {
    return request<void>(`/api/projects/${projectId}/files/${fileId}`, {
      method: "DELETE",
      headers: {}
    });
  },
  listPresets() {
    return request<PresetsResponse>("/api/presets");
  },
  getSettings() {
    return request<SettingsResponse>("/api/settings");
  },
  updateSettings(payload: SettingsUpdateRequest) {
    return request<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  createJob(projectId: string, payload: JobCreateRequest) {
    return request<JobSummary>(`/api/projects/${projectId}/jobs`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  exportCandidate(projectId: string, jobId: string, candidateId: string, captionsEnabled?: boolean) {
    return request<JobSummary>(`/api/projects/${projectId}/jobs/${jobId}/candidates/${candidateId}/export`, {
      method: "POST",
      body: JSON.stringify({ captions_enabled: captionsEnabled })
    });
  },
  getJob(jobId: string) {
    return request<JobSummary>(`/api/jobs/${jobId}`);
  },
  getJobTrace(jobId: string) {
    return request<JobTraceResponse>(`/api/jobs/${jobId}/trace`);
  },
  cancelJob(jobId: string) {
    return request<JobSummary>(`/api/jobs/${jobId}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    });
  }
};
