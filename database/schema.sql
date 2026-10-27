-- =====================================================
-- DATABASE HYBRID ENERGY MONITORING
-- =====================================================

-- Hapus database lama jika ada (HATI-HATI!)
DROP DATABASE IF EXISTS hybrid_energy;

-- Buat database baru
CREATE DATABASE hybrid_energy;
USE hybrid_energy;

-- =====================================================
-- TABEL SENSOR DATA (Menyimpan semua data dari ESP32)
-- =====================================================
CREATE TABLE sensor_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tegangan_ac FLOAT DEFAULT 0,
    arus_ac FLOAT DEFAULT 0,
    daya_beban FLOAT DEFAULT 0,
    tegangan_baterai FLOAT DEFAULT 0,
    frekuensi FLOAT DEFAULT 0,
    power_factor FLOAT DEFAULT 0,
    energi_kwh FLOAT DEFAULT 0,
    suhu FLOAT DEFAULT 0,
    kelembaban FLOAT DEFAULT 0,
    sumber_aktif VARCHAR(10) DEFAULT 'PLN',
    
    INDEX idx_waktu (waktu),
    INDEX idx_sumber (sumber_aktif)
);

-- =====================================================
-- TABEL CONTROL LOG (Riwayat kontrol dari website)
-- =====================================================
CREATE TABLE control_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    perintah VARCHAR(20),
    sumber_tujuan VARCHAR(10),
    status VARCHAR(20),
    ip_address VARCHAR(45)
);

-- =====================================================
-- TABEL DEVICE STATUS (Status ESP32 dan relay)
-- =====================================================
CREATE TABLE device_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    relay_pln BOOLEAN DEFAULT FALSE,
    relay_plts BOOLEAN DEFAULT FALSE,
    esp32_online BOOLEAN DEFAULT FALSE,
    last_ip VARCHAR(45),
    last_data_received TIMESTAMP NULL
);

-- =====================================================
-- CEK HASIL
-- =====================================================
SHOW TABLES;
SELECT '✅ Database dan semua tabel berhasil dibuat!' as STATUS;