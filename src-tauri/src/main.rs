#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;

use serde::Serialize;
use std::{fs, io, path::PathBuf, process::Command};
use tauri::{AppHandle, Manager};

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn template_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app_data(app)?.join("templates");
    let initialize = || -> io::Result<()> {
        let first_run = !path.exists();
        fs::create_dir_all(&path)?;
        if first_run {
            storage::write(&path.join("classic.json"), include_bytes!("../../src/templates/classic.json"), false)?;
            storage::write(&path.join("minimal.json"), include_bytes!("../../src/templates/minimal.json"), false)?;
        }
        let added: [(&str, &[u8]); 2] = [
            ("classic-ranked.json", include_bytes!("../../src/templates/classic-ranked.json")),
            ("classic-zh-cn.json", include_bytes!("../../src/templates/classic-zh-cn.json")),
        ];
        for (name, contents) in added {
            let file = path.join(name);
            if !file.exists() {
                storage::write(&file, contents, false)?;
            }
        }
        Ok(())
    };
    initialize().map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(path)
}

#[derive(Serialize)]
struct TemplateFile {
    id: String,
    text: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn list_templates(app: AppHandle) -> Result<Vec<TemplateFile>, String> {
    let path = template_dir(&app)?;
    let entries = fs::read_dir(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    let mut templates = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json")) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        templates.push(match fs::read_to_string(path) {
            Ok(text) => TemplateFile { id, text: Some(text), error: None },
            Err(error) => TemplateFile { id, text: None, error: Some(error.to_string()) },
        });
    }
    templates.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(templates)
}

#[tauri::command]
fn open_template_dir(app: AppHandle) -> Result<(), String> {
    let path = template_dir(&app)?;
    #[cfg(target_os = "windows")]
    let opener = "explorer.exe";
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let opener = "xdg-open";
    let mut command = Command::new(opener);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.arg(path).spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_workspace(app: AppHandle, backup: bool) -> Result<Option<String>, String> {
    let path = app_data(&app)?.join("workspace-v1.json");
    let path = if backup { storage::backup_path(&path) } else { path };
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

#[tauri::command]
fn save_workspace(app: AppHandle, text: String, keep_backup: bool) -> Result<(), String> {
    let path = app_data(&app)?.join("workspace-v1.json");
    storage::write(&path, text.as_bytes(), !keep_backup)
        .map_err(|error| format!("{}: {error}", path.display()))
}

#[tauri::command]
async fn read_document(path: PathBuf) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))
}

#[tauri::command]
async fn write_document(path: PathBuf, text: String, backup: bool) -> Result<(), String> {
    storage::write(&path, text.as_bytes(), backup)
        .map_err(|error| format!("{}: {error}", path.display()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_templates, open_template_dir, read_workspace, save_workspace,
            read_document, write_document
        ])
        .run(tauri::generate_context!())
        .expect("failed to start IRC Log Studio");
}
