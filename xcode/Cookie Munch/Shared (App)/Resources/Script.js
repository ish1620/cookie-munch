// The app's welcome page. ViewController.swift calls show(platform, enabled, useSettings, language).

const TEXT = {
    ja: {
        tagline: 'SafariのCookieバナーを自動で拒否し、拒否できないものは隠します。「同意」は押しません。',
        mac1: 'Safariの設定 → 機能拡張 を開きます。',
        mac2: 'Cookie Munchにチェックを入れます。',
        mac3: '「Webサイトを編集…」で「その他のWebサイト」を「許可」にします。',
        macOn: 'SafariでCookie Munchはオンになっています。',
        macOff: 'SafariでCookie Munchは今オフです。',
        macOpen: '終了してSafariの設定を開く…',
        macOpenOld: '終了してSafariの環境設定を開く…',
        ios1: '設定 → アプリ → Safari → 機能拡張 を開きます。',
        ios2: 'Cookie Munchをタップし、「機能拡張を許可」をオンにします。',
        ios3: '「アクセス許可」で「すべてのWebサイト」を「許可」にします。',
        after: 'あとはいつも通りブラウズするだけ。SafariのCookie Munchボタンで、各ページで何をしたか確認できます。',
        source: '無料のオープンソース',
        private: 'データは一切送信しません',
    },
    es: {
        tagline: 'Rechaza por ti los avisos de cookies en Safari y oculta los que no se pueden rechazar. Nunca pulsa «Aceptar».',
        mac1: 'Abre Ajustes de Safari → Extensiones.',
        mac2: 'Marca Cookie Munch.',
        mac3: 'Pulsa «Editar sitios web…» y pon «Otros sitios web» en «Permitir».',
        macOn: 'Cookie Munch está activado en Safari.',
        macOff: 'Cookie Munch está desactivado en Safari ahora mismo.',
        macOpen: 'Salir y abrir los Ajustes de Safari…',
        macOpenOld: 'Salir y abrir las Preferencias de Safari…',
        ios1: 'Abre Ajustes → Apps → Safari → Extensiones.',
        ios2: 'Toca Cookie Munch y activa «Permitir extensión».',
        ios3: 'En Permisos, pon «Todos los sitios web» en «Permitir».',
        after: 'Después, navega como siempre. El botón de Cookie Munch en Safari muestra qué ha hecho en cada página.',
        source: 'Libre y de código abierto',
        private: 'No envía nada a ningún sitio',
    },
};

function translate(language) {
    const table = TEXT[(language || '').slice(0, 2)];
    if (!table) return;
    document.documentElement.lang = language.slice(0, 2);
    for (const element of document.querySelectorAll('[data-text]')) {
        const text = table[element.dataset.text];
        if (text) element.textContent = text;
    }
}

function show(platform, enabled, useSettingsInsteadOfPreferences, language) {
    document.body.classList.add(`platform-${platform}`);
    translate(language);

    if (useSettingsInsteadOfPreferences === false) {
        // macOS 12 still calls it Preferences.
        const button = document.querySelector('button.open-preferences');
        button.textContent = TEXT[(language || '').slice(0, 2)]?.macOpenOld ?? 'Quit and Open Safari Preferences…';
    }

    if (typeof enabled === 'boolean') {
        document.body.classList.toggle('state-on', enabled);
        document.body.classList.toggle('state-off', !enabled);
    } else {
        document.body.classList.remove('state-on', 'state-off');
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage('open-preferences');
}

document.querySelector('button.open-preferences').addEventListener('click', openPreferences);
