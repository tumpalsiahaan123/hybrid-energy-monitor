const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// ========== KONEKSI DATABASE ==========
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'hybrid_energy'
});

db.connect((err) => {
  if (err) {
    console.error('❌ Database error:', err);
    return;
  }
  console.log('✅ Database MySQL terhubung!');
  
  const createSensorTable = `
    CREATE TABLE IF NOT EXISTS sensor_data (
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
      sumber_aktif VARCHAR(10) DEFAULT 'PLN'
    )`;
  
  const createControlLog = `
    CREATE TABLE IF NOT EXISTS control_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      perintah VARCHAR(20),
      sumber_tujuan VARCHAR(10),
      status VARCHAR(20),
      ip_address VARCHAR(45)
    )`;
  
  db.query(createSensorTable, (err) => {
    if (err) console.error('Error:', err);
    else console.log('✅ Tabel sensor_data siap');
  });
  
  db.query(createControlLog, (err) => {
    if (err) console.error('Error:', err);
    else console.log('✅ Tabel control_log siap');
  });
});

// ========== VARIABEL GLOBAL UNTUK COMMAND ==========
let currentCommand = 'auto';

// ========== API UNTUK ESP32 ==========
app.post('/api/data', (req, res) => {
  const { ac, watt, bat, freq, pf, energi, suhu, sumber } = req.body;
  console.log(`📊 Data: ${watt}W | Bat: ${bat}V`);
  
  const sql = `INSERT INTO sensor_data 
    (tegangan_ac, daya_beban, tegangan_baterai, frekuensi, power_factor, energi_kwh, suhu, sumber_aktif) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.query(sql, [ac, watt, bat, freq, pf, energi, suhu, sumber || 'AUTO'], (err) => {
    if (err) console.error('Error:', err.message);
    res.json({ status: 'ok' });
  });
});

// ESP32 BACA PERINTAH (GET)
app.get('/api/command', (req, res) => {
  res.send(currentCommand);
});

// WEBSITE KIRIM PERINTAH (POST)
app.post('/api/control', (req, res) => {
  const { command } = req.body;
  console.log(`🎮 Perintah: ${command}`);
  
  // SIMPAN command ke variabel
  currentCommand = command;
  
  // Tentukan sumber_tujuan berdasarkan command
  let sumberTujuan = '';
  if (command === 'pln') sumberTujuan = 'PLN';
  else if (command === 'plts') sumberTujuan = 'PLTS';
  else if (command === 'off') sumberTujuan = 'OFF';
  else sumberTujuan = 'AUTO';
  
  const sql = 'INSERT INTO control_log (perintah, sumber_tujuan) VALUES (?, ?)';
  db.query(sql, [command, sumberTujuan]);
  
  // Pesan response yang sesuai
  let pesan = '';
  if (command === 'off') pesan = 'Kedua sumber dimatikan (OFF)';
  else if (command === 'auto') pesan = 'Mode AUTO diaktifkan';
  else pesan = `Pindah ke ${command.toUpperCase()}`;
  
  res.json({ status: 'success', message: pesan });
});

// ========== API UNTUK WEBSITE ==========
app.get('/api/latest', (req, res) => {
  db.query('SELECT * FROM sensor_data ORDER BY waktu DESC LIMIT 1', (err, results) => {
    if (err) res.json({});
    else res.json(results[0] || {});
  });
});

app.get('/api/history', (req, res) => {
  const days = req.query.days || 7;
  const type = req.query.type || 'daya';
  
  let sql = '';
  if (type === 'daya') {
    sql = `SELECT DATE(waktu) as tanggal, 
           AVG(daya_beban) as rata_daya, 
           MIN(daya_beban) as min_daya,
           MAX(daya_beban) as max_daya,
           SUM(energi_kwh) as total_energi,
           COUNT(*) as jumlah_data
    FROM sensor_data 
    WHERE waktu >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(waktu) ORDER BY tanggal DESC`;
  } else {
    sql = `SELECT DATE(waktu) as tanggal, 
           AVG(tegangan_baterai) as rata_baterai
    FROM sensor_data 
    WHERE waktu >= DATE_SUB(NOW(), INTERVAL ? DAY)
    GROUP BY DATE(waktu) ORDER BY tanggal DESC`;
  }
  
  db.query(sql, [parseInt(days)], (err, results) => {
    if (err) res.json({ data: [] });
    else res.json({ data: results });
  });
});

app.get('/api/stats', (req, res) => {
  const sql = `SELECT 
    SUM(CASE WHEN sumber_aktif = 'PLN' THEN energi_kwh ELSE 0 END) as total_pln,
    SUM(CASE WHEN sumber_aktif = 'PLTS' THEN energi_kwh ELSE 0 END) as total_plts,
    AVG(daya_beban) as avg_daya
    FROM sensor_data WHERE waktu >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`;
  
  db.query(sql, (err, results) => {
    if (err) res.json({ total_pln: 0, total_plts: 0, persen_plts: 0, avg_daya: 0 });
    else {
      const total = (results[0].total_pln || 0) + (results[0].total_plts || 0);
      const persen = total > 0 ? ((results[0].total_plts || 0) / total * 100) : 0;
      res.json({ 
        total_pln: results[0].total_pln || 0, 
        total_plts: results[0].total_plts || 0, 
        persen_plts: persen,
        avg_daya: results[0].avg_daya || 0
      });
    }
  });
});

  // =====================================================
// API UNTUK STATISTIK PLN vs PLTS PER PERIODE
// =====================================================

// Statistik per Hari (dalam rentang tanggal)
app.get('/api/stats/periode', (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate dan endDate diperlukan' });
  }
  
  const sql = `
    SELECT 
      DATE(waktu) as tanggal,
      SUM(CASE WHEN sumber_aktif = 'PLN' THEN energi_kwh ELSE 0 END) as energi_pln,
      SUM(CASE WHEN sumber_aktif = 'PLTS' THEN energi_kwh ELSE 0 END) as energi_plts,
      SUM(energi_kwh) as total_energi
    FROM sensor_data 
    WHERE DATE(waktu) BETWEEN ? AND ?
    GROUP BY DATE(waktu)
    ORDER BY tanggal ASC
  `;
  
  db.query(sql, [startDate, endDate], (err, results) => {
    if (err) {
      console.error('Error:', err);
      res.json({ data: [] });
    } else {
      res.json({ data: results });
    }
  });
});

// Statistik per Bulan
app.get('/api/stats/bulan', (req, res) => {
  const { bulan, tahun } = req.query;
  const tahunNow = tahun || new Date().getFullYear();
  const bulanNow = bulan || new Date().getMonth() + 1;
  
  const sql = `
    SELECT 
      DATE(waktu) as tanggal,
      SUM(CASE WHEN sumber_aktif = 'PLN' THEN energi_kwh ELSE 0 END) as energi_pln,
      SUM(CASE WHEN sumber_aktif = 'PLTS' THEN energi_kwh ELSE 0 END) as energi_plts,
      SUM(energi_kwh) as total_energi
    FROM sensor_data 
    WHERE YEAR(waktu) = ? AND MONTH(waktu) = ?
    GROUP BY DATE(waktu)
    ORDER BY tanggal ASC
  `;
  
  db.query(sql, [tahunNow, bulanNow], (err, results) => {
    if (err) {
      res.json({ data: [] });
    } else {
      let totalPLN = 0;
      let totalPLTS = 0;
      let totalEnergi = 0;
      
      results.forEach(row => {
        totalPLN += row.energi_pln || 0;
        totalPLTS += row.energi_plts || 0;
        totalEnergi += row.total_energi || 0;
      });
      
      res.json({ 
        bulan: bulanNow,
        tahun: tahunNow,
        data: results,
        ringkasan: {
          total_pln: totalPLN,
          total_plts: totalPLTS,
          total_energi: totalEnergi,
          persen_plts: totalEnergi > 0 ? (totalPLTS / totalEnergi * 100).toFixed(1) : 0
        }
      });
    }
  });
});

// Statistik per Tahun
app.get('/api/stats/tahun', (req, res) => {
  const { tahun } = req.query;
  const tahunNow = tahun || new Date().getFullYear();
  
  const sql = `
    SELECT 
      MONTH(waktu) as bulan,
      SUM(CASE WHEN sumber_aktif = 'PLN' THEN energi_kwh ELSE 0 END) as energi_pln,
      SUM(CASE WHEN sumber_aktif = 'PLTS' THEN energi_kwh ELSE 0 END) as energi_plts,
      SUM(energi_kwh) as total_energi
    FROM sensor_data 
    WHERE YEAR(waktu) = ?
    GROUP BY MONTH(waktu)
    ORDER BY bulan ASC
  `;
  
  db.query(sql, [tahunNow], (err, results) => {
    if (err) {
      res.json({ data: [] });
    } else {
      const namaBulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const formattedData = results.map(row => ({
        bulan: namaBulan[row.bulan - 1],
        energi_pln: row.energi_pln || 0,
        energi_plts: row.energi_plts || 0,
        total_energi: row.total_energi || 0
      }));
      
      let totalPLN = 0;
      let totalPLTS = 0;
      results.forEach(row => {
        totalPLN += row.energi_pln || 0;
        totalPLTS += row.energi_plts || 0;
      });
      
      res.json({ 
        tahun: tahunNow,
        data: formattedData,
        ringkasan: {
          total_pln: totalPLN,
          total_plts: totalPLTS,
          total_energi: totalPLN + totalPLTS,
          persen_plts: (totalPLN + totalPLTS) > 0 ? (totalPLTS / (totalPLN + totalPLTS) * 100).toFixed(1) : 0
        }
      });
    }
  });
});

// ========== FRONTEND ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ========== START SERVER ==========
const PORT = 3000;
app.listen(PORT, () => {
  console.log('========================================');
  console.log('   HYBRID ENERGY MONITORING SYSTEM');
  console.log('========================================');
  console.log(`   ✅ Server Running`);
  console.log(`   📡 BUKA: http://localhost:${PORT}`);
  console.log('========================================');
});