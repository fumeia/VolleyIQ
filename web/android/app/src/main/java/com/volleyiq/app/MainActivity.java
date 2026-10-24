package com.volleyiq.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VolleyIQPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
