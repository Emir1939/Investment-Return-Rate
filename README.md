# Investment Return Application

Modern, kullanıcı dostu bir Full-Stack uygulama - FastAPI (Python) backend ve React TypeScript frontend ile geliştirilmiştir.

## 🚀 Özellikler

- ✅ Kullanıcı kaydı (Sign Up)
- ✅ Kullanıcı girişi (Sign In)
- ✅ JWT tabanlı kimlik doğrulama
- ✅ Güvenli şifre hashleme
- ✅ Modern ve responsive UI
- ✅ Korumalı rotalar
- ✅ SQLite veritabanı

## 📋 Gereksinimler

### Backend
- Python 3.8+
- pip

### Frontend
- Node.js 16+
- npm veya yarn

## 🛠️ Kurulum

### Backend Kurulumu

1. Backend dizinine gidin:
```bash
cd backend
```

2. Sanal ortam oluşturun (önerilir):
```bash
python -m venv venv
```

3. Sanal ortamı aktifleştirin:
- Windows:
```bash
venv\Scripts\activate
```
- Mac/Linux:
```bash
source venv/bin/activate
```

4. Gerekli paketleri yükleyin:
```bash
pip install -r requirements.txt
```

5. Sunucuyu başlatın:
```bash
python main.py
```

Backend `http://localhost:8000` adresinde çalışacaktır.

### Frontend Kurulumu

1. Frontend dizinine gidin:
```bash
cd frontend
```

2. Bağımlılıkları yükleyin:
```bash
npm install
```

3. Geliştirme sunucusunu başlatın:
```bash
npm start
```

Frontend `http://localhost:3000` adresinde çalışacaktır.

## 📚 API Endpoints

- `POST /api/signup` - Yeni kullanıcı kaydı
- `POST /api/login` - Kullanıcı girişi
- `GET /api/me` - Mevcut kullanıcı bilgileri (korumalı)

## 🎨 UI Özellikleri

- Modern gradient tasarım
- Animasyonlu formlar
- Responsive tasarım (mobil uyumlu)
- Kullanıcı dostu hata mesajları
- Loading states
- Form validasyonu

## 🔒 Güvenlik

- Bcrypt ile şifre hashleme
- JWT token tabanlı kimlik doğrulama
- CORS koruması
- Güvenli HTTP-only token yönetimi

## 📝 Kullanım

1. Uygulamayı başlattıktan sonra `http://localhost:3000` adresine gidin
2. "Sign Up" butonuna tıklayarak yeni hesap oluşturun
3. Email, kullanıcı adı ve şifre bilgilerinizi girin
4. Giriş yaptıktan sonra dashboard'a yönlendirileceksiniz

## 🤝 Katkıda Bulunma

Bu proje açık kaynak kodludur. Katkılarınızı bekliyoruz!

## 📄 Lisans

MIT License
