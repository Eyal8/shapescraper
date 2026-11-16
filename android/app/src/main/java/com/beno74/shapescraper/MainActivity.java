package com.beno74.shapescraper;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AnalyticsConsentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
