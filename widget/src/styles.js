export function getWidgetStyles(buttonStyles) {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    #botiga-negotiate-btn {
      width: 100%;
      cursor: pointer;
      border: 1.5px solid ${buttonStyles.backgroundColor};
      background: transparent;
      color: ${buttonStyles.backgroundColor};
      font-family: ${buttonStyles.fontFamily};
      font-size: ${buttonStyles.fontSize};
      border-radius: ${buttonStyles.borderRadius};
      padding: ${buttonStyles.padding || '12px 20px'};
      margin-top: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-weight: 500;
      transition: all 0.15s;
    }

    #botiga-negotiate-btn:hover {
      background: ${buttonStyles.backgroundColor};
      color: ${buttonStyles.color || '#fff'};
    }

    .botiga-attr {
      font-size: 9px;
      color: #aaa;
      text-align: center;
      margin-top: 4px;
      font-family: system-ui, sans-serif;
    }

    /* Chat widget overlay */
    #botiga-chat-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 2147483646;
      display: flex;
      align-items: flex-end;
      justify-content: center;
    }

    #botiga-chat-panel {
      background: #fff;
      border-radius: 16px 16px 0 0;
      width: 100%;
      max-width: 420px;
      height: 520px;
      display: flex;
      flex-direction: column;
      font-family: ${buttonStyles.fontFamily};
      overflow: hidden;
      box-shadow: 0 -8px 40px rgba(0,0,0,0.18);
    }

    .botiga-chat-header {
      padding: 16px 20px;
      background: ${buttonStyles.backgroundColor};
      color: ${buttonStyles.color || '#fff'};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .botiga-chat-header h3 { font-size: 15px; font-weight: 600; }
    .botiga-chat-header p { font-size: 11px; opacity: 0.8; margin-top: 2px; }

    .botiga-close-btn {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font-size: 20px;
      opacity: 0.8;
      padding: 0 4px;
    }

    .botiga-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #f7f7f8;
    }

    .botiga-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.5;
    }

    .botiga-msg.bot {
      background: #fff;
      color: #1a1a1a;
      border-radius: 14px 14px 14px 2px;
      align-self: flex-start;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    .botiga-msg.user {
      background: ${buttonStyles.backgroundColor};
      color: ${buttonStyles.color || '#fff'};
      border-radius: 14px 14px 2px 14px;
      align-self: flex-end;
    }

    .botiga-typing {
      font-size: 12px;
      color: #999;
      align-self: flex-start;
      padding: 6px 0;
    }

    .botiga-input-row {
      display: flex;
      padding: 12px 16px;
      gap: 8px;
      border-top: 1px solid #eee;
      background: #fff;
    }

    .botiga-input {
      flex: 1;
      border: 1.5px solid #ddd;
      border-radius: 20px;
      padding: 10px 16px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border 0.15s;
    }

    .botiga-input:focus { border-color: ${buttonStyles.backgroundColor}; }

    .botiga-send-btn {
      background: ${buttonStyles.backgroundColor};
      color: ${buttonStyles.color || '#fff'};
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }

    .botiga-send-btn:disabled { opacity: 0.5; cursor: default; }

    /* Deal banner */
    #botiga-deal-banner {
      padding: 16px;
      background: #f0fff4;
      border-top: 1px solid #d1fae5;
    }

    .botiga-deal-banner-title {
      font-size: 14px;
      font-weight: 600;
      color: #065f46;
      margin-bottom: 4px;
    }

    .botiga-deal-price {
      font-size: 22px;
      font-weight: 700;
      color: #047857;
    }

    .botiga-deal-original {
      font-size: 12px;
      color: #999;
      text-decoration: line-through;
      margin-left: 6px;
    }

    .botiga-deal-timer {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
    }

    .botiga-checkout-btn {
      display: block;
      width: 100%;
      margin-top: 12px;
      padding: 12px;
      background: #047857;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      transition: background 0.15s;
    }

    .botiga-checkout-btn:hover { background: #065f46; }

    /* Exit intent popup */
    #botiga-exit-popup {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2147483647;
      background: #fff;
      border-radius: 16px;
      padding: 28px;
      width: 340px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      font-family: ${buttonStyles.fontFamily};
    }

    #botiga-exit-popup h3 { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
    #botiga-exit-popup p { font-size: 13px; color: #666; margin-bottom: 16px; }

    .botiga-exit-input {
      width: 100%;
      border: 1.5px solid #ddd;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 10px;
      font-family: inherit;
      outline: none;
    }

    .botiga-exit-input:focus { border-color: ${buttonStyles.backgroundColor}; }

    .botiga-exit-submit {
      width: 100%;
      padding: 12px;
      background: ${buttonStyles.backgroundColor};
      color: ${buttonStyles.color || '#fff'};
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .botiga-exit-skip {
      display: block;
      text-align: center;
      margin-top: 10px;
      font-size: 12px;
      color: #999;
      cursor: pointer;
      background: none;
      border: none;
      font-family: inherit;
    }
  `;
}
