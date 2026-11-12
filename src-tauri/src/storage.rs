use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".bak");
    PathBuf::from(name)
}

fn stage(path: &Path, contents: &[u8]) -> io::Result<NamedTempFile> {
    if !path.is_absolute() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Expected an absolute file path"));
    }
    let parent = path.parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Expected a file path"))?;
    fs::create_dir_all(parent)?;
    let mut temp = NamedTempFile::new_in(parent)?;
    temp.write_all(contents)?;
    temp.as_file().sync_all()?;
    Ok(temp)
}

pub fn write(path: &Path, contents: &[u8], backup: bool) -> io::Result<()> {
    let temp = stage(path, contents)?;
    if backup {
        match fs::read(path) {
            Ok(previous) => {
                let backup = backup_path(path);
                stage(&backup, &previous)?.persist(backup).map_err(|error| error.error)?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    temp.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_atomically_and_keeps_previous_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.irclogproj");
        write(&path, "旧内容".as_bytes(), true).unwrap();
        write(&path, "新内容".as_bytes(), true).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "新内容");
        assert_eq!(fs::read_to_string(backup_path(&path)).unwrap(), "旧内容");
        write(&path, b"recovered", false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "recovered");
        assert_eq!(fs::read_to_string(backup_path(&path)).unwrap(), "旧内容");
    }
}
